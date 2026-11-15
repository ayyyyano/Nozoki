# Agent 快速部署

把下列任务交给能在仓库运行命令的助手。准备自己的 Cloudflare 账户和 GitHub Fork，在浏览器完成需要本人确认的 OAuth 授权。

```text
在当前 Nozoki 仓库准备 Cloudflare Workers 部署。先读 docs/deploy/cloudflare.md 和
docs/operations/environment.md，与我确认账户、Worker 名称、数据库、站点域名及部署方式。
创建或修改远程资源、运行远程迁移、提交和推送代码前，分别确认我已授权的范围。
核对 Node、pnpm、Git 和当前 Git 状态，使用根锁文件安装依赖。
在 wrangler.jsonc 填写我自己的数据库绑定和登录地址，运行 pnpm build。
获准后用 pnpm deploy:cloudflare 完成迁移和发布。我自行在交互提示中填写运行时 Secret。
需要 Git 自动部署时，按我选择的 Workers Builds 或 GitHub Actions 指南操作。
用部署地址验证首页、管理员登录、配置保存和采集状态，列出仍需我处理的事项。
把密码、随机密钥和 API Token 保存在授权的 Secret 中，日志和提交中使用占位值。
```

[Workers Builds](./cloudflare-builds.md) · [GitHub Actions](./github-actions.md)
