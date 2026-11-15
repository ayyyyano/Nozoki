# Nozoki

<img src="public/logo.png" width="96" align="right" alt="Nozoki Logo">

[在线演示](https://nozoki.nekro.top/) · [使用文档](https://ayyyyano.github.io/Nozoki/)

Nozoki 是基于 Nuxt 4 的个人看板，支持模块配置、来源采集和访客隐私控制。可部署到 Cloudflare Workers 与 D1，也可在 Node.js 服务器上使用 SQLite。

![使用示例数据的 Nozoki 看板](docs/public/preview.png)

## 看板功能

- **账户**：DeepSeek 余额趋势、Codex 额度与用量观测。
- **设备**：Sleepy 设备状态与电量、Tailscale 节点状态。
- **日常**：「在干嘛」日程与倒计时、自选行情、常用链接。
- **监控**：UptimeFlare 与 Uptime Kuma 服务状态。

管理后台可配置共享外观、数据源和访客可见性。界面使用 Vue 3、Varlet 和 Material 3。

## 快速开始

- [Cloudflare Workers 初始化](https://ayyyyano.github.io/Nozoki/deploy/cloudflare.html)
- [Workers Builds](https://ayyyyano.github.io/Nozoki/deploy/cloudflare-builds.html) · [GitHub Actions 自动部署](https://ayyyyano.github.io/Nozoki/deploy/github-actions.html)
- [Node.js 自部署](https://ayyyyano.github.io/Nozoki/deploy/node.html)
- [Agent 快速部署](https://ayyyyano.github.io/Nozoki/deploy/agent.html)
- [本地运行](https://ayyyyano.github.io/Nozoki/deploy/local.html)

使用仓库锁定的 Node.js 和 pnpm，在本地启动：

```sh
pnpm install --frozen-lockfile
pnpm db:init
pnpm dev
```

## 许可证与致谢

项目采用 [MIT](LICENSE) 许可证。第三方许可见 [public/licenses](public/licenses/)。加载动画来自 [maimai-transition](https://github.com/gfdfdxc/maimai-transition)。
