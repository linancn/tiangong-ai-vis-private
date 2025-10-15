#!/usr/bin/env node

import { render } from '@antv/gpt-vis-ssr';
import type { Options } from '@antv/gpt-vis-ssr/dist/esm/types.js';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cluster from 'node:cluster';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const imagesDir = path.join(publicDir, 'images');

try {
  mkdirSync(imagesDir, { recursive: true });
} catch (error) {
  console.error('Failed to ensure image output directory', error);
  throw error;
}

export type ServerConfig = {
  port: number;
  host: string;
  bodyLimit: string;
  maxConcurrency: number;
  maxQueueSize: number;
  keepAliveTimeoutMs: number;
  headersTimeoutMs: number;
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

  const defaultConcurrency = Math.max(1, Math.floor(cpuCount / Math.max(workerCount, 1)) || 1);
  const maxConcurrency = parsePositiveInteger(process.env.MAX_CONCURRENCY, defaultConcurrency);
  const maxQueueSize = parseNonNegativeInteger(
    process.env.MAX_QUEUE_SIZE,
    Math.max(maxConcurrency * 4, maxConcurrency),
  );
  const keepAliveTimeoutMs = parsePositiveInteger(process.env.KEEP_ALIVE_TIMEOUT_MS, 65000);
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
    keepAliveTimeoutMs: overrides.keepAliveTimeoutMs ?? keepAliveTimeoutMs,
    headersTimeoutMs: overrides.headersTimeoutMs ?? headersTimeoutMs,
  };
}

export function createRenderApp(config: ServerConfig): Express {
  const app = express();
  const concurrencyGate = new ConcurrencyGate(config.maxConcurrency, config.maxQueueSize);

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

  app.use('/images', express.static(imagesDir));

  app.post('/render', async (req: Request, res: Response) => {
    let acquired = false;
    let renderResult: Awaited<ReturnType<typeof render>> | undefined;
    try {
      const options = normalizeOptions(req.body);
      await concurrencyGate.acquire();
      acquired = true;

      const start = process.hrtime.bigint();
      renderResult = await render(options);
      const buffer = await Promise.resolve(renderResult.toBuffer());
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

      const filename = `${randomUUID()}.png`;
      const filePath = path.join(imagesDir, filename);
      await fs.writeFile(filePath, buffer);

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Render-Time', elapsedMs.toFixed(2));

      const hostHeader = req.get('host');
      const host =
        hostHeader && hostHeader.trim().length > 0 ? hostHeader : `${config.host}:${config.port}`;
      const protocol = req.protocol ?? 'http';
      const imageUrl = `${protocol}://${host}/images/${filename}`;

      res.json({
        success: true,
        resultObj: imageUrl,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.status).json({
          success: false,
          errorMessage: error.message,
        });
        return;
      }

      console.error('渲染图表时出错:', error);
      res.status(500).json({
        success: false,
        errorMessage: `渲染图表失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      if (acquired) {
        concurrencyGate.release();
      }
      renderResult?.destroy();
    }
  });

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      errorMessage: 'Route not found',
    });
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
          success: false,
          errorMessage: 'Request body must be valid JSON.',
        });
        return;
      }

      console.error('Unexpected error while handling request', err);
      res.status(500).json({
        success: false,
        errorMessage: `渲染图表失败: ${
          err instanceof Error ? err.message : 'Unexpected error while rendering chart.'
        }`,
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

function normalizeOptions(body: unknown): Options {
  if (!body || typeof body !== 'object') {
    throw new HttpError('缺少必要的参数: type 或 data', 400, 'invalid_request');
  }

  const container = body as { options?: unknown };
  const hasNestedOptions =
    container !== null &&
    typeof container === 'object' &&
    Object.prototype.hasOwnProperty.call(container, 'options') &&
    container.options !== null &&
    typeof container.options === 'object';
  const candidate = hasNestedOptions ? container.options : body;

  if (!candidate || typeof candidate !== 'object') {
    throw new HttpError('缺少必要的参数: type 或 data', 400, 'invalid_request');
  }

  const options = candidate as Record<string, unknown>;

  if (typeof options.type !== 'string' || options.type.trim().length === 0) {
    throw new HttpError('缺少必要的参数: type 或 data', 400, 'invalid_request');
  }

  if (!Object.prototype.hasOwnProperty.call(options, 'data')) {
    throw new HttpError('缺少必要的参数: type 或 data', 400, 'invalid_request');
  }

  return candidate as Options;
}

function isJsonSyntaxError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { type?: string };
  return err.type === 'entity.parse.failed';
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
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
  const requested = parsePositiveInteger(process.env.WORKERS, 4);
  return Math.max(1, Math.min(getAvailableParallelism(), requested));
}

export async function bootstrap(): Promise<void> {
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
      const graceful = code === 0 || signal === 'SIGINT' || signal === 'SIGTERM';
      const exitLog = `[primary] worker ${worker.id} exited (code=${code}, signal=${signal})`;

      if (graceful) {
        console.log(`${exitLog}, not restarting`);
        return;
      }

      console.warn(`${exitLog}, restarting...`);
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
