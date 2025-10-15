# TianGong AI VIS Private Server# TianGong-AI-VIS-PRIVATE



基于 [@antv/gpt-vis-ssr](https://github.com/antvis/GPT-Vis) 的高性能图表渲染服务，支持集群模式、并发控制和 HTTP API。### 本地启动



## 功能特性```bash

npm start

- 🚀 **高性能渲染**: 基于 @antv/gpt-vis-ssr 的服务端图表渲染```

- 🔄 **集群模式**: 支持多进程集群，充分利用多核 CPU
- ⚡ **并发控制**: 内置并发限制和请求队列管理，防止资源耗尽
- 🔌 **HTTP API**: 简单易用的 RESTful API 接口
- 📊 **健康检查**: 内置健康检查端点，支持监控和负载均衡
- 🎯 **多种响应格式**: 支持 Buffer 和 Base64 两种响应格式
- 🛡️ **优雅关闭**: 支持优雅关闭，确保请求处理完成
- ⚙️ **灵活配置**: 通过环境变量灵活配置服务参数

## 快速开始

### 安装

```bash
npm install @tiangong-ai/vis-server
```

### 使用 CLI

```bash
# 使用默认配置启动
npx tiangong-ai-vis-private

# 使用环境变量配置
PORT=8080 WORKERS=4 npx tiangong-ai-vis-private

# 使用 .env 配置文件（推荐）
# 1. 创建 .env 文件
cp .env.example .env
# 2. 编辑 .env 文件设置配置
# 3. 启动服务
npx tiangong-ai-vis-private
```

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

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `WORKERS` | 工作进程数量 | CPU 核心数 |
| `MAX_CONCURRENCY` | 每个工作进程的最大并发数 | CPU 核心数 / 工作进程数 |
| `MAX_QUEUE_SIZE` | 最大队列大小 | `MAX_CONCURRENCY * 4` |
| `BODY_LIMIT` | 请求体大小限制 | `1mb` |
| `KEEP_ALIVE_TIMEOUT_MS` | Keep-Alive 超时时间（毫秒） | `65000` |
| `HEADERS_TIMEOUT_MS` | Headers 超时时间（毫秒） | `70000` |

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

# 复制环境变量配置文件（可选）
cp .env.example .env
# 然后根据需要编辑 .env 文件

# 构建并启动
npm start

# 或使用环境变量
PORT=8080 npm start
```

**提示**: 如果系统 CPU 核心数较多（如超过 16 核），强烈建议创建 `.env` 文件并设置合理的 `WORKERS` 数量（推荐 2-8 个），以避免创建过多进程。

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

## 错误处理

| HTTP 状态码 | 错误代码 | 描述 |
|------------|---------|------|
| 400 | `invalid_json` | 请求体不是有效的 JSON |
| 400 | `invalid_request` | 缺少必需参数或参数格式错误 |
| 404 | `not_found` | 路由不存在 |
| 500 | `internal_error` | 内部渲染错误 |
| 503 | `service_unavailable` | 服务繁忙，队列已满 |

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关项目

- [@antv/gpt-vis](https://github.com/antvis/GPT-Vis) - 基于 LLM 的可视化生成库
- [@antv/gpt-vis-ssr](https://github.com/antvis/GPT-Vis) - 服务端渲染支持
