# 选择部署方式

| 场景                               | 指南                                     | 存储与采集                |
| ---------------------------------- | ---------------------------------------- | ------------------------- |
| Cloudflare 托管应用                | [初始化 Cloudflare](./cloudflare.md)     | D1、Worker Cron           |
| 用 Cloudflare 连接 Git 仓库        | [Workers Builds](./cloudflare-builds.md) | 推送生产分支后构建和发布  |
| 用 GitHub Runner 发布到 Cloudflare | [GitHub Actions](./github-actions.md)    | 推送默认分支后构建和发布  |
| 自有服务器或持久卷                 | [Node.js 自部署](./node.md)              | 本机 SQLite、系统定时任务 |
| 本机预览或调试                     | [本地运行](./local.md)                   | 本地 D1 模拟存储          |
| 委托助手部署                       | [Agent 快速部署](./agent.md)             | 按所选部署方式执行        |

同一个 Worker 选择一种 Git 自动部署方式。GitHub Pages 发布本使用指南，线上看板及 API 由你选择的应用运行环境提供。

## 本地工具

安装 Git、[Node.js 24.21.0](https://nodejs.org/download/release/v24.21.0/) 和 pnpm 12.15.0。可用 Node 随附的 npm 安装 pnpm CLI，仓库依赖由 pnpm 统一管理。

```sh
npm install --global pnpm@12.15.0
git clone https://github.com/ayyyyano/Nozoki.git
cd Nozoki
pnpm install --frozen-lockfile
```

自动部署时，把克隆地址改成你自己的 Fork。后续命令从仓库根目录执行。
