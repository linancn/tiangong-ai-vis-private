````markdown
# TianGong AI VIS Private Server - 开发指南

本项目是一个基于 [@antv/gpt-vis-ssr](https://github.com/antvis/GPT-Vis) 的高性能图表渲染服务，提供 HTTP API 接口，支持集群模式和并发控制。

## 技术栈

- **运行时**: Node.js 18+
- **框架**: Express.js
- **渲染引擎**: @antv/gpt-vis-ssr
- **语言**: TypeScript
- **进程管理**: Node.js Cluster API

## 项目结构

```
tiangong-ai-vis-private/
├── src/
│   └── index.ts          # 主服务文件，包含所有核心功能
├── dist/                 # 编译输出目录
├── package.json
├── tsconfig.json
├── README_CN.md
└── DEV_CN.md
```

## 核心功能模块

### 1. 集群管理 (`bootstrap()`)

- 在主进程中启动多个工作进程
- 自动监控工作进程退出并重启
- 通过 `WORKERS` 环境变量控制工作进程数量
- 默认值为 CPU 核心数

### 2. HTTP 服务器 (`createRenderApp()`)

提供以下端点:

- `GET /healthz` - 健康检查，返回服务状态和性能指标
- `POST /render` - 渲染图表，接收配置并返回图片

### 3. 并发控制 (`ConcurrencyGate`)

- 限制每个工作进程的并发渲染数量
- 请求队列管理，避免内存溢出
- 队列满时返回 503 错误
- 支持动态查询队列大小和活跃请求数

### 4. 配置管理 (`resolveConfig()`)

- 从环境变量读取配置
- 提供合理的默认值
- 支持运行时覆盖
- 自动计算最优并发数

### 5. 错误处理

- 统一的 HTTP 错误响应格式
- 自定义错误类型 (`HttpError`, `ServiceBusyError`)
- JSON 解析错误捕获
- 渲染错误处理

### 6. 优雅关闭 (`setupGracefulShutdown()`)

- 监听 SIGTERM 和 SIGINT 信号
- 等待当前请求完成
- 超时强制退出（5秒）

## 开发环境设置

### 1. 安装 Node.js

推荐使用 nvm 管理 Node.js 版本：

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash

# 安装 Node.js 22
nvm install 22
nvm use 22

# 验证安装
node --version
npm --version
```

### 2. 克隆项目并安装依赖

```bash
git clone <repository-url>
cd tiangong-ai-vis-private

# 安装依赖
npm install

# 或使用 ci 命令（推荐 CI/CD）
npm ci
```

### 3. 开发模式启动

```bash
# 构建并启动（生产模式）
npm start

# 使用 tsx 直接运行（开发模式，支持热重载）
npx tsx src/index.ts

# 使用环境变量
PORT=8080 WORKERS=2 MAX_CONCURRENCY=4 npx tsx src/index.ts
```

## 构建和测试

### 构建

```bash
# 清理并构建
npm run build

# 只清理
npm run build:clean

# 构建后的文件在 dist/ 目录
```

构建过程:
1. 删除旧的 `dist` 目录
2. 使用 TypeScript 编译器编译 TS 文件
3. 复制 `public` 目录到 `dist`（如果存在）
4. 给生成的 JS 文件添加执行权限

### 代码格式化

```bash
# 格式化所有代码文件
npm run lint

# Prettier 配置支持:
# - JavaScript/TypeScript
# - JSON
# - Markdown
# - 自动组织 imports (prettier-plugin-organize-imports)
```

### 测试

```bash
# 运行测试（如果有）
npm test
```

## 调试

### VSCode 调试配置

创建 `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Server",
      "program": "${workspaceFolder}/src/index.ts",
      "runtimeArgs": ["-r", "tsx"],
      "env": {
        "PORT": "3000",
        "WORKERS": "1",
        "MAX_CONCURRENCY": "2"
      },
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### 使用 Chrome DevTools 调试

```bash
node --inspect dist/src/index.js
```

然后在 Chrome 中打开 `chrome://inspect`。

## 本地测试 API

### 健康检查

```bash
curl http://localhost:3000/healthz
```

### 渲染图表

```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      "type": "line",
      "data": [
        {"x": "2021-01", "y": 100},
        {"x": "2021-02", "y": 200},
        {"x": "2021-03", "y": 150}
      ]
    },
    "responseType": "base64"
  }'
```

### 性能测试

使用 Apache Bench 或类似工具:

```bash
# 安装 ab
sudo apt-get install apache2-utils

# 创建测试数据文件
echo '{"options":{"type":"line","data":[{"x":"A","y":10}]}}' > test-data.json

# 并发测试
ab -n 100 -c 10 -p test-data.json -T application/json http://localhost:3000/render
```

## 依赖管理

### 更新依赖

```bash
# 检查可更新的包
npm run ncu

# 交互式更新
npm run ncu:update

# 安装更新后的依赖
npm install
```

### 主要依赖

- `@antv/gpt-vis-ssr`: 核心渲染引擎
- `express`: HTTP 服务器框架
- `@types/express`: Express 类型定义

### 开发依赖

- `typescript`: TypeScript 编译器
- `tsx`: TypeScript 执行器（开发用）
- `prettier`: 代码格式化
- `dotenv-cli`: 环境变量管理
- `shx`: 跨平台 shell 命令

## 发布流程

### 1. 更新版本号

```bash
# 修补版本 (0.0.x)
npm version patch

# 次要版本 (0.x.0)
npm version minor

# 主要版本 (x.0.0)
npm version major
```

### 2. 构建

```bash
npm run build
```

### 3. 测试构建产物

```bash
# 测试 CLI
node dist/src/index.js

# 测试 API
curl http://localhost:3000/healthz
```

### 4. 发布到 npm

```bash
# 首次发布需要登录
npm login

# 发布
npm update && npm ci
```

### 5. 验证发布

```bash
# 查看包信息
npm view @tiangong-ai/vis-server

# 安装测试
npm install @tiangong-ai/vis-server
npx tiangong-ai-vis-private
```

## 环境变量配置

创建 `.env` 文件用于本地开发:

```bash
PORT=3000
HOST=0.0.0.0
WORKERS=4
MAX_CONCURRENCY=4
MAX_QUEUE_SIZE=16
BODY_LIMIT=1mb
KEEP_ALIVE_TIMEOUT_MS=65000
HEADERS_TIMEOUT_MS=70000
```

使用 dotenv-cli 运行:

```bash
npx dotenv -e .env -- node dist/src/index.js
```

## 常见问题

### 1. 端口被占用

```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>

# 或使用不同端口
PORT=8080 npm start
```

### 2. 内存不足

调整 Node.js 内存限制:

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

或减少并发数和队列大小:

```bash
MAX_CONCURRENCY=2 MAX_QUEUE_SIZE=4 npm start
```

### 3. TypeScript 编译错误

确保 TypeScript 版本兼容:

```bash
npm install typescript@latest --save-dev
npm run build
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 遵循 TypeScript 最佳实践
- 使用 Prettier 格式化代码
- 添加必要的类型注释
- 编写清晰的注释和文档

## 许可证

MIT License - 详见 LICENSE 文件

````
