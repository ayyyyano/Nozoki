# GitHub Actions 部署

Fork 后，先在自己的仓库打开 **Actions** 并启用工作流。Worker 和文档的工作流都跟随 Fork 自己的默认分支。GitHub Runner 使用锁定的 Wrangler，平时推送的设备只需要 Git。

## 配置 Worker 发布

1. 准备自己的 Worker、D1 数据库和站点地址，并更新 `wrangler.jsonc`。参见[账户与数据库配置](./cloudflare.md#创建数据库和设置域名)。
2. 创建限定到目标账户的 Cloudflare API Token，赋予账户级 **Workers Scripts Edit** 和 **D1 Edit**。如由 Wrangler 管理自定义域名或路由，按实际配置添加对应区域权限。在 Fork 的 **Settings → Environments** 创建 `production`，将允许部署的分支限制到默认分支，并添加环境 Secret `CLOUDFLARE_API_TOKEN`。
3. 将配置推送到 Fork 默认分支，在 **Actions → Deploy to Cloudflare Workers** 查看部署。也可以从同一工作流手动选择默认分支运行。首次部署成功后，设置[运行时 Secret](./cloudflare.md#设置运行时-secret)，检查登录、保存和采集。如果同一 Worker 已连接 Workers Builds，改用 Actions 时由站点所有者停用原 Git 自动构建。

工作流会通过 Token 自动解析单个账户的 ID。若检测到多个账户，或希望固定使用某个账户，在 **Settings → Secrets and variables → Actions → Variables** 设置仓库变量 `CLOUDFLARE_ACCOUNT_ID`。未配置 Token、Token 无法列出账户或存在多个账户但未指定 ID 时，工作流会失败并提示处理方法。默认分支限制仍由工作流和环境共同执行，数据库迁移失败会终止发布。

仅修改 `docs/`、README 或文档工作流会跳过 Worker 部署。同步包含根锁文件或工作区配置的提交可能同时触发两条工作流。只部署 Worker 时，可在 Fork 的 **Actions → Deploy documentation to GitHub Pages** 菜单中选择 **Disable workflow**。如果文档工作流已触发但 Pages 尚未启用，该次文档发布可能失败，Worker 工作流仍独立运行。

## 发布文档站（可选）

1. 在自己的 Fork 打开 **Settings → Pages**，将发布来源选为 **GitHub Actions**。
2. 仓库名为 `Nozoki` 时使用现有的 `/Nozoki/`。如果改了仓库名，将 `docs/.vitepress/config.mts` 中的 `base` 改为 `/<新仓库名>/`，大小写与仓库名一致。
3. 把文档配置推送至默认分支。如果已经同步了最新代码，从 **Actions → Deploy documentation to GitHub Pages** 选择默认分支手动运行。
4. 发布成功后，从该次运行打开站点。项目站点默认位于 `https://<所有者>.github.io/<仓库名>/`。

Pages 作业构建并上传 `docs/.vitepress/dist/`，使用 `github-pages` 环境及 GitHub Pages 原生权限。Worker 部署使用独立的 `production` 环境。

[GitHub Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
