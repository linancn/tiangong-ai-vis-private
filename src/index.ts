#!/usr/bin/env node

import cluster from 'node:cluster';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import process from 'node:process';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { render } from '@antv/gpt-vis-ssr';
import type { Options } from '@antv/gpt-vis-ssr/dist/esm/types.js';
import { pathToFileURL } from 'node:url';

type ResponseType = 'buffer' | 'base64';

export type ServerConfig = {
  port: number;
  host: string;
  bodyLimit: string;
  maxConcurrency: number;
  maxQueueSize: number;
  keepAliveTimeoutMs: number;
  headersTimeoutMs: number;
};

type RenderRequestBody = {
  options: Options;
  meta?: unknown;
  responseType?: ResponseType;
  contentType?: string;
  fileName?: string;
};

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class ServiceBusyError extends HttpError {
  constructor(message = 'Render queue is full, please retry later.') {
    super(message, 503, 'service_unavailable');
  }
}

class ConcurrencyGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueue: number,
  ) {}

  async acquire(): Promise<void> {
    if (this.maxActive <= 0) {
      return;
    }

    if (this.active < this.maxActive) {
      this.active += 1;
      return;
    }

    if (this.maxQueue >= 0 && this.queue.length >= this.maxQueue) {
      throw new ServiceBusyError();
    }

    await new Promise<void>((resolve) => {
      const entry = () => {
        this.active += 1;
        resolve();
      };
      this.queue.push(entry);
    });
  }

  release(): void {
    if (this.maxActive <= 0) {
      return;
    }

    if (this.active > 0) {
      this.active -= 1;
    }

    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  getQueueSize(): number {
    if (this.maxActive <= 0) {
      return 0;
    }
    return this.queue.length;
  }

  getActiveCount(): number {
    if (this.maxActive <= 0) {
      return 0;
    }
    return this.active;
  }
}

export function resolveConfig(
  overrides: Partial<ServerConfig> = {},
  workerCount = parsePositiveInteger(process.env.SERVER_WORKER_COUNT, 1),
): ServerConfig {
  const cpuCount = getAvailableParallelism();
  const port = parsePositiveInteger(process.env.PORT, 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const bodyLimit = process.env.BODY_LIMIT ?? '1mb';

  const defaultConcurrency = Math.max(
    1,
    Math.floor(cpuCount / Math.max(workerCount, 1)) || 1,
  );
  const maxConcurrency = parsePositiveInteger(
    process.env.MAX_CONCURRENCY,
    defaultConcurrency,
  );
  const maxQueueSize = parseNonNegativeInteger(
    process.env.MAX_QUEUE_SIZE,
    Math.max(maxConcurrency * 4, maxConcurrency),
  );
  const keepAliveTimeoutMs = parsePositiveInteger(
    process.env.KEEP_ALIVE_TIMEOUT_MS,
    65000,
  );
  const headersTimeoutMs = Math.max(
    keepAliveTimeoutMs + 5000,
    parsePositiveInteger(process.env.HEADERS_TIMEOUT_MS, 70000),
  );

  return {
    port: overrides.port ?? port,
    host: overrides.host ?? host,
    bodyLimit: overrides.bodyLimit ?? bodyLimit,
    maxConcurrency: overrides.maxConcurrency ?? maxConcurrency,
    maxQueueSize: overrides.maxQueueSize ?? maxQueueSize,
    keepAliveTimeoutMs:
      overrides.keepAliveTimeoutMs ?? keepAliveTimeoutMs,
    headersTimeoutMs: overrides.headersTimeoutMs ?? headersTimeoutMs,
  };
}

export function createRenderApp(config: ServerConfig): Express {
  const app = express();
  const concurrencyGate = new ConcurrencyGate(
    config.maxConcurrency,
    config.maxQueueSize,
  );

  app.disable('x-powered-by');
  app.use(express.json({ limit: config.bodyLimit }));

  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      pid: process.pid,
      uptime: process.uptime(),
      workerId: cluster.isWorker ? cluster.worker?.id : 0,
      queueSize: concurrencyGate.getQueueSize(),
      active: concurrencyGate.getActiveCount(),
      concurrency: config.maxConcurrency,
    });
  });

  app.post(
    '/render',
    async (req: Request, res: Response, next: NextFunction) => {
      let acquired = false;
      let renderResult: Awaited<ReturnType<typeof render>> | undefined;
      try {
        const payload = normalizeRequest(req.body);
        await concurrencyGate.acquire();
        acquired = true;

        const start = process.hrtime.bigint();
        renderResult = await render(payload.options);
        const buffer = renderResult.toBuffer(payload.meta);
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

        const responseType = payload.responseType ?? 'buffer';
        const contentType = payload.contentType ?? 'image/png';

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Render-Time', elapsedMs.toFixed(2));

        if (payload.fileName && responseType === 'buffer') {
          res.setHeader(
            'Content-Disposition',
            `inline; filename="${sanitizeFileName(payload.fileName)}"`,
          );
        }

        if (responseType === 'base64') {
          res.json({
            contentType,
            data: buffer.toString('base64'),
            elapsedMs,
          });
          return;
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(buffer.length));
        res.end(buffer);
      } catch (error) {
        if (error instanceof ServiceBusyError) {
          res
            .status(error.status)
            .json({ error: error.code, message: error.message });
          return;
        }

        if (error instanceof HttpError) {
          res.status(error.status).json({
            error: error.code,
            message: error.message,
            details: error.details,
          });
          return;
        }

        next(error);
        return;
      } finally {
        if (acquired) {
          concurrencyGate.release();
        }
        renderResult?.destroy();
      }
    },
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Route not found' });
  });

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: NextFunction,
    ) => {
      if (isJsonSyntaxError(err)) {
        res.status(400).json({
          error: 'invalid_json',
          message: 'Request body must be valid JSON.',
        });
        return;
      }

      console.error('Unexpected error while handling request', err);
      res.status(500).json({
        error: 'internal_error',
        message: 'Unexpected error while rendering chart.',
      });
    },
  );

  return app;
}

export async function startServer(
  config: Partial<ServerConfig> = {},
): Promise<{ server: Server; app: Express; config: ServerConfig }> {
  const resolved = resolveConfig(config);
  const app = createRenderApp(resolved);
  const server = createServer(app);
  server.keepAliveTimeout = resolved.keepAliveTimeoutMs;
  server.headersTimeout = resolved.headersTimeoutMs;

  await new Promise<void>((resolve) => {
    server.listen(resolved.port, resolved.host, resolve);
  });

  console.log(
    `[worker ${cluster.isWorker ? cluster.worker?.id : 0}] listening on http://${resolved.host}:${resolved.port}`,
  );

  setupGracefulShutdown(server);

  return { server, app, config: resolved };
}

function setupGracefulShutdown(server: Server) {
  let shuttingDown = false;
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(
      `[worker ${cluster.isWorker ? cluster.worker?.id : 0}] received ${signal}, starting graceful shutdown...`,
    );
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  };

  signals.forEach((signal) => {
    process.once(signal, () => shutdown(signal));
  });
}

function normalizeRequest(body: unknown): RenderRequestBody {
  if (!body || typeof body !== 'object') {
    throw new HttpError(
      'Request body must be a JSON object with an "options" property.',
      400,
      'invalid_request',
    );
  }

  const payload = body as Partial<RenderRequestBody>;

  if (!payload.options || typeof payload.options !== 'object') {
    throw new HttpError(
      'Missing "options" property in request body.',
      400,
      'invalid_request',
    );
  }

  if (typeof payload.options.type !== 'string') {
    throw new HttpError(
      '"options.type" must be a string corresponding to a supported chart type.',
      400,
      'invalid_request',
    );
  }

  if (
    payload.responseType &&
    payload.responseType !== 'buffer' &&
    payload.responseType !== 'base64'
  ) {
    throw new HttpError(
      '"responseType" must be either "buffer" or "base64".',
      400,
      'invalid_request',
    );
  }

  if (
    payload.contentType !== undefined &&
    typeof payload.contentType !== 'string'
  ) {
    throw new HttpError(
      '"contentType" must be a string when provided.',
      400,
      'invalid_request',
    );
  }

  if (
    payload.fileName !== undefined &&
    typeof payload.fileName !== 'string'
  ) {
    throw new HttpError(
      '"fileName" must be a string when provided.',
      400,
      'invalid_request',
    );
  }

  const contentType =
    typeof payload.contentType === 'string'
      ? payload.contentType.trim() || undefined
      : undefined;
  const fileName =
    typeof payload.fileName === 'string'
      ? payload.fileName.trim() || undefined
      : undefined;

  return {
    options: payload.options as Options,
    meta: payload.meta,
    responseType: payload.responseType,
    contentType,
    fileName,
  };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]/g, '_');
}

function isJsonSyntaxError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { type?: string };
  return err.type === 'entity.parse.failed';
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function getAvailableParallelism(): number {
  if (typeof os.availableParallelism === 'function') {
    return os.availableParallelism();
  }
  return os.cpus().length;
}

function determineWorkerCount(): number {
  const requested = parsePositiveInteger(
    process.env.WORKERS,
    getAvailableParallelism(),
  );
  return Math.max(1, Math.min(getAvailableParallelism(), requested));
}

async function bootstrap(): Promise<void> {
  if (cluster.isPrimary) {
    const workerCount = determineWorkerCount();
    console.log(`[primary] starting ${workerCount} worker(s)...`);
    cluster.setupPrimary({ silent: false });
    for (let index = 0; index < workerCount; index += 1) {
      cluster.fork({
        ...process.env,
        SERVER_WORKER_COUNT: String(workerCount),
      });
    }

    cluster.on('exit', (worker, code, signal) => {
      console.warn(
        `[primary] worker ${worker.id} exited (code=${code}, signal=${signal}), restarting...`,
      );
      cluster.fork({
        ...process.env,
        SERVER_WORKER_COUNT: String(workerCount),
      });
    });
    return;
  }

  await startServer({
    // The per-worker default concurrency is computed inside resolveConfig.
  });
}

const isCliEntrypoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCliEntrypoint) {
  bootstrap().catch((error) => {
    console.error('Failed to start GPT-Vis SSR service', error);
    process.exit(1);
  });
}
