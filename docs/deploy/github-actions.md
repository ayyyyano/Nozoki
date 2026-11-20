# GitHub Actions 部署

Fork 后，先在自己的仓库打开 **Actions** 并启用工作流。Worker 和文档的工作流都跟随 Fork 自己的默认分支。GitHub Runner 使用锁定的 Wrangler，平时推送的设备只需要 Git。

## 配置 Worker 发布

1. 准备自己的 Worker、D1 数据库和站点地址，并更新 `wrangler.jsonc`。Fork 必须改成自己的值：**`AUTH_ORIGIN`**（最终访问地址，不改会导致登录失败）、**`ADMIN_EMAIL`**（管理员邮箱）；建议同时改 `name` 与 `database_name`。`database_id` 可交给[数据库自举](#首次部署数据库自举)自动处理。参见[账户与数据库配置](./cloudflare.md#创建数据库和设置域名)。
2. 创建限定到目标账户的 Cloudflare API Token，赋予账户级 **Workers Scripts Edit** 和 **D1 Edit**。启用数据库自举时，Token 还需能列出并创建 D1（D1 Edit 模板通常已覆盖）。如由 Wrangler 管理自定义域名或路由，按实际配置添加对应区域权限。在 Fork 的 **Settings → Environments** 创建 `production`，将允许部署的分支限制到默认分支，并添加环境 Secret `CLOUDFLARE_API_TOKEN`。
3. 将配置推送到 Fork 默认分支，在 **Actions → Deploy to Cloudflare Workers** 查看部署。也可以从同一工作流手动选择默认分支运行。首次部署成功后，设置[运行时 Secret](./cloudflare.md#设置运行时-secret)，检查登录、保存和采集。如果同一 Worker 已连接 Workers Builds，改用 Actions 时由站点所有者停用原 Git 自动构建。

工作流会通过 Token 自动解析单个账户的 ID。若检测到多个账户，或希望固定使用某个账户，在 **Settings → Secrets and variables → Actions → Variables** 设置仓库变量 `CLOUDFLARE_ACCOUNT_ID`。未配置 Token、Token 无法列出账户或存在多个账户但未指定 ID 时，工作流会失败并提示处理方法。默认分支限制仍由工作流和环境共同执行，数据库迁移失败会终止发布。

仅修改 `docs/`、README 或文档工作流会跳过 Worker 部署。同步包含根锁文件或工作区配置的提交可能同时触发两条工作流。只部署 Worker 时，可在 Fork 的 **Actions → Deploy documentation to GitHub Pages** 菜单中选择 **Disable workflow**。如果文档工作流已触发但 Pages 尚未启用，该次文档发布可能失败，Worker 工作流仍独立运行。

## 首次部署：数据库自举

默认推送不会创建任何远程资源：工作流按 `wrangler.jsonc` 里的 `database_id` 直接应用迁移并发布，数据库不存在时部署会失败。启用自举后，构建之后会多执行一步：

1. 读取 `wrangler.jsonc` 中 `DB` 绑定的 `database_name`，**忽略仓库里原有的 `database_id`**。
2. 用 Token 列出当前账户的 D1 数据库：按名字找到就复用，找不到才创建。
3. 把取得的 `database_id` 写入 runner 上的临时配置 `wrangler.bootstrap.jsonc`，本次迁移与发布都指向它。仓库里的 `wrangler.jsonc` 不会被修改，也不会推回仓库（工作流只有 `contents: read` 权限）。

开启方式二选一：

- 在 **Actions → Deploy to Cloudflare Workers → Run workflow** 选择默认分支，勾选 `bootstrap_database`；
- 在 **Settings → Secrets and variables → Actions → Variables** 添加仓库变量 `CLOUDFLARE_BOOTSTRAP_D1=true`，让后续推送都执行自举。

想让仓库配置与线上一致时，可把日志里打印的新 ID 手工填回 `wrangler.jsonc` 再提交；不填也能正常部署，因为自举每次都按名字查库。

### Fork 检查清单

| 项目                                    | 谁负责                          | 不改的后果                           |
| --------------------------------------- | ------------------------------- | ------------------------------------ |
| `AUTH_ORIGIN`、`ADMIN_EMAIL`            | Fork 所有者改 `wrangler.jsonc`  | 登录校验失败、管理员邮箱仍是上游的   |
| `name`、`database_name`                 | 建议改                          | 与上游同名，只影响辨识               |
| `database_id`                           | 自举自动覆盖，也可手工填        | 部署连到不存在的数据库               |
| `production` 环境 Secret、运行时 Secret | 本人在 GitHub / Cloudflare 配置 | 工作流失败或无法登录、保存凭据       |
| 自定义域名                              | 本人在 Cloudflare 绑定          | 只能通过 workers.dev 地址访问        |
| 历史数据                                | 不提供                          | 自举只建空表，凭据与采集历史不会回来 |

边界：自举只创建空数据库并应用建表迁移，**不恢复任何数据**；工作流不删除 Worker/D1、不同步运行时 Secret、不绑定自定义域名。删除与密钥设置始终由站点所有者本人完成。

## 发布文档站（可选）

1. 在自己的 Fork 打开 **Settings → Pages**，将发布来源选为 **GitHub Actions**。
2. 仓库名为 `Nozoki` 时使用现有的 `/Nozoki/`。如果改了仓库名，将 `docs/.vitepress/config.mts` 中的 `base` 改为 `/<新仓库名>/`，大小写与仓库名一致。
3. 把文档配置推送至默认分支。如果已经同步了最新代码，从 **Actions → Deploy documentation to GitHub Pages** 选择默认分支手动运行。
4. 发布成功后，从该次运行打开站点。项目站点默认位于 `https://<所有者>.github.io/<仓库名>/`。

Pages 作业构建并上传 `docs/.vitepress/dist/`，使用 `github-pages` 环境及 GitHub Pages 原生权限。Worker 部署使用独立的 `production` 环境。

[GitHub Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
