# 本地运行

准备 [Node、pnpm 和 Git](./index.md#本地工具)，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm db:init
pnpm dev
```

打开 `http://127.0.0.1:3000`。本地数据库位于 `.wrangler/state/v3`，可用 `pnpm db:migrate` 应用新迁移。需要固定调试账号时，复制 `.dev.vars.example` 为 `.dev.vars` 后填写[认证配置](/operations/environment.md)。

也可运行 `pnpm dev:local`。命令会提供本地管理员账号，登录信息写在 `.wrangler/local-debug/LOGIN.txt`。首次运行复制日常数据库，调试写入 `.wrangler/local-debug/state/v3`。启动前先停止占用 3000 端口的服务。

## 预览 Worker 产物

```sh
pnpm build
pnpm preview
```

打开 `http://127.0.0.1:8787`。联调登录时，`AUTH_ORIGIN` 应设为当前端口的地址。需要手动触发本地采集时，访问 Wrangler 预览的 `/cdn-cgi/handler/scheduled`。

## 预览产品文档

```sh
pnpm --filter nozoki-docs dev
pnpm --filter nozoki-docs build
pnpm --filter nozoki-docs preview
```

根据终端显示的端口打开 `/Nozoki/`。VitePress 输出位于 `docs/.vitepress/dist/`，应用的静态产物位于 `.output/public`。
