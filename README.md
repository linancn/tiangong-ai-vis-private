# TianGong-AI-VIS-PRIVATE

基于 [@antv/gpt-vis-ssr](https://github.com/antvis/GPT-Vis) 的高性能图表渲染服务，支持集群模式、并发控制和 HTTP API。

## 功能特性

- 🚀 **高性能渲染**: 基于 @antv/gpt-vis-ssr 的服务端图表渲染
- 🔄 **集群模式**: 支持多进程集群，充分利用多核 CPU
- ⚡ **并发控制**: 内置并发限制和请求队列管理，防止资源耗尽
- 🔌 **HTTP API**: 简单易用的 RESTful API 接口
- 📊 **健康检查**: 内置健康检查端点，支持监控和负载均衡
- 🎯 **多种响应格式**: 支持 Buffer 和 Base64 两种响应格式
- 🛡️ **优雅关闭**: 支持优雅关闭，确保请求处理完成
- ⚙️ **灵活配置**: 通过环境变量灵活配置服务参数
- 🔧 **零配置启动**: 无需 .env 文件，所有配置都有合理的默认值

## 快速开始

### 安装

```bash
npm install @tiangong-ai/vis-server
```

### 使用 CLI

```bash
# 使用默认配置启动（无需任何配置文件）
npx tiangong-ai-vis-private

# 使用环境变量配置
PORT=8080 WORKERS=4 npx tiangong-ai-vis-private

# 使用 .env 配置文件（生产环境推荐）
# 1. 创建 .env 文件
cp .env.example .env
# 2. 编辑 .env 文件设置配置
# 3. 启动服务
npx tiangong-ai-vis-private
```

> **注意**: 服务可以在没有任何配置文件的情况下直接启动，所有参数都有合理的默认值。

### 作为依赖使用

```typescript
import { startServer } from '@tiangong-ai/vis-server';

// 启动服务器
const { server, app, config } = await startServer({
  port: 3000,
  host: '0.0.0.0',
  maxConcurrency: 4,
  maxQueueSize: 16,
});

console.log(`Server running on http://${config.host}:${config.port}`);
```

## API 文档

### POST /render

渲染图表并返回图片。

**请求体**:

```json
{
  "options": {
    "type": "line",
    "data": [...],
    "config": {...}
  },
  "responseType": "buffer",
  "contentType": "image/png",
  "fileName": "chart.png",
  "meta": {...}
}
```

**参数说明**:

- `options` (必需): 图表配置对象，符合 @antv/gpt-vis-ssr 的 Options 类型
  - `type`: 图表类型（如 'line', 'bar', 'pie' 等）
  - `data`: 图表数据
  - `config`: 图表配置
- `responseType` (可选): 响应类型，可选 `"buffer"` (默认) 或 `"base64"`
- `contentType` (可选): 内容类型，默认 `"image/png"`
- `fileName` (可选): 文件名（仅在 responseType 为 "buffer" 时有效）
- `meta` (可选): 传递给渲染器的元数据

**响应 (responseType: "buffer")**:

```
Content-Type: image/png
Content-Length: 12345
X-Render-Time: 123.45

<二进制图片数据>
```

**响应 (responseType: "base64")**:

```json
{
  "contentType": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAA...",
  "elapsedMs": 123.45
}
```

### GET /healthz

健康检查端点。

**响应**:

```json
{
  "status": "ok",
  "pid": 12345,
  "uptime": 123.45,
  "workerId": 1,
  "queueSize": 2,
  "active": 3,
  "concurrency": 4
}
```

## 配置

### 环境变量

所有配置项都是**可选的**，未设置时会使用默认值。

| 变量名 | 描述 | 默认值 | 说明 |
|--------|------|--------|------|
| `PORT` | 服务端口 | `3000` | HTTP 服务监听端口 |
| `HOST` | 监听地址 | `0.0.0.0` | 监听所有网络接口 |
| `WORKERS` | 工作进程数量 | `4` | 推荐 2-8 个，根据负载调整 |
| `MAX_CONCURRENCY` | 每个工作进程的最大并发数 | `4` | 动态计算：CPU核心数 / WORKERS |
| `MAX_QUEUE_SIZE` | 最大队列大小 | `16` | 动态计算：MAX_CONCURRENCY × 4 |
| `BODY_LIMIT` | 请求体大小限制 | `1mb` | 支持单位: b, kb, mb, gb |
| `KEEP_ALIVE_TIMEOUT_MS` | Keep-Alive 超时时间（毫秒） | `65000` | 连接保持时间 |
| `HEADERS_TIMEOUT_MS` | Headers 超时时间（毫秒） | `70000` | 应该比 Keep-Alive 长 |

> **提示**: `MAX_CONCURRENCY` 和 `MAX_QUEUE_SIZE` 如果不设置，会根据系统 CPU 核心数和 WORKERS 数量自动计算最优值。

### 示例

```bash
# 启动 4 个工作进程，每个进程最多处理 2 个并发请求
PORT=8080 \
WORKERS=4 \
MAX_CONCURRENCY=2 \
MAX_QUEUE_SIZE=8 \
npx tiangong-ai-vis-private
```

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/TianGong-AI/tiangong-ai-vis-private.git
cd tiangong-ai-vis-private

# 安装依赖
npm install

# 方式 1: 直接启动（使用默认配置）
npm start

# 方式 2: 使用环境变量启动
PORT=8080 WORKERS=2 npm start

# 方式 3: 使用 .env 文件（推荐用于生产环境）
cp .env.example .env
# 编辑 .env 文件设置配置
npm run start:env
```

### 可用脚本

- `npm start` - 构建并启动服务（使用默认配置或环境变量）
- `npm run start:env` - 构建并启动服务（从 .env 文件加载配置）
- `npm run build` - 编译 TypeScript 到 dist 目录
- `npm test` - 运行测试
- `npm run lint` - 格式化代码

### 配置说明

**零配置启动**: 服务可以直接运行，所有参数都有合理的默认值。

**使用环境变量**: 适合临时调整配置或在容器环境中使用。

**使用 .env 文件**: 适合生产环境，配置更清晰，避免命令行过长。参考 `.env.example` 文件查看所有可配置项。

## 生产部署

### 使用 Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
ENV PORT=3000
ENV WORKERS=4
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
```

### 使用 PM2

```json
{
  "apps": [{
    "name": "vis-server",
    "script": "dist/src/index.js",
    "instances": 1,
    "exec_mode": "fork",
    "env": {
      "PORT": 3000,
      "WORKERS": 4,
      "MAX_CONCURRENCY": 4
    }
  }]
}
```

```bash
pm2 start ecosystem.config.json
```

## 架构说明

- **主进程**: 负责管理工作进程，监控进程退出并自动重启
- **工作进程**: 处理实际的渲染请求，每个进程独立运行
- **并发控制**: 使用 `ConcurrencyGate` 限制每个工作进程的并发数
- **请求队列**: 当并发达到上限时，请求会进入队列等待
- **优雅关闭**: 收到 SIGTERM/SIGINT 信号时，等待当前请求完成后关闭

## 性能调优

### WORKERS 配置建议

- **低负载场景** (< 100 QPS): `WORKERS=2`
- **中等负载场景** (100-500 QPS): `WORKERS=4`
- **高负载场景** (> 500 QPS): `WORKERS=8`

### MAX_CONCURRENCY 配置建议

- **简单图表** (折线图、柱状图): `MAX_CONCURRENCY=4-8`
- **复杂图表** (大数据量、复杂交互): `MAX_CONCURRENCY=2-4`

### 性能优化提示

1. **合理设置 WORKERS**: 不要设置过多，建议不超过 CPU 核心数的一半
2. **调整并发数**: 根据图表复杂度和内存使用情况调整 `MAX_CONCURRENCY`
3. **队列大小**: `MAX_QUEUE_SIZE` 建议设置为 `MAX_CONCURRENCY × 4`
4. **监控健康检查**: 通过 `/healthz` 端点监控队列大小和活跃连接数
5. **使用负载均衡**: 在高负载场景下，建议使用 Nginx 或 HAProxy 做负载均衡

## 错误处理

| HTTP 状态码 | 错误代码 | 描述 |
|------------|---------|------|
| 400 | `invalid_json` | 请求体不是有效的 JSON |
| 400 | `invalid_request` | 缺少必需参数或参数格式错误 |
| 404 | `not_found` | 路由不存在 |
| 500 | `internal_error` | 内部渲染错误 |
| 503 | `service_unavailable` | 服务繁忙，队列已满 |

当收到 503 错误时，客户端应该实现重试机制（建议使用指数退避策略）。

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关项目

- [@antv/gpt-vis](https://github.com/antvis/GPT-Vis) - 基于 LLM 的可视化生成库
- [@antv/gpt-vis-ssr](https://github.com/antvis/GPT-Vis) - 服务端渲染支持
