# Workers Builds

Workers Builds 从 GitHub 拉取源码，在 Cloudflare 构建并发布 Worker。先完成 [Cloudflare 初始化](./cloudflare.md) 中的账户、数据库和 `wrangler.jsonc` 配置，并将配置提交到自己的仓库。

1. 在 Cloudflare 打开 **Workers & Pages → Create application**，连接 Git 仓库。已有 Worker 可从其设置中的 **Build** 连接。
2. 授权 Cloudflare 的 GitHub 应用读取你的仓库，选择生产分支。
3. 填写下表，保存并检查构建结果。

| 设置        | 值                                    |
| ----------- | ------------------------------------- |
| Worker 名称 | 与 `wrangler.jsonc` 的 `name` 一致    |
| 生产分支    | 自己仓库的实际生产分支，例如 `master` |
| 根目录      | 仓库根目录                            |
| 构建命令    | `pnpm build`                          |
| 部署命令    | `pnpm deploy:cloudflare`              |

仓库已锁定 Node 和 pnpm 版本。如构建环境需要显式设置，填入 `NODE_VERSION=24.21.0`、`PNPM_VERSION=12.15.0`。部署令牌须有目标账户的 **Workers Scripts Edit** 与 **D1 Edit** 权限。应用密码和加密密钥放在 Worker 运行时 Secret 中。

## 跳过文档专属推送

在 Worker 的 **Settings → Build → Build watch paths** 保留 Include 为 `*`，在 Exclude 中添加以下规则：

```text
docs/*
README.md
README_EN.md
AGENTS.md
.github/workflows/deploy-docs.yml
```

保留根 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `package.json` 的触发。共享锁文件无法由路径过滤可靠归属到单个包。Cloudflare 对空推送、文件达到 3000 个或包含至少 20 个提交的推送会跳过路径判断并构建。应用和文档同时有改动时，应用路径仍会命中。

[Cloudflare Git 仓库部署](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)

首次发布后，按[初始化指南](./cloudflare.md#设置运行时-secret)填写运行时 Secret，并测试站点登录及保存。
