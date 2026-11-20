# Cloudflare 初始化

Nozoki 在同一个 Worker 中运行看板、API 和定时采集。部署命令会对绑定的 D1 应用待执行迁移，然后发布 Worker。

## 创建数据库和设置域名

1. 在自己的 Cloudflare 账户启用 `workers.dev` 子域名，并创建 Nozoki 专用的 D1 数据库。也可在 Wrangler 授权后使用下列命令。
2. 在自己 Fork 的 `wrangler.jsonc` 中填写 Worker 名称和自己的 `database_name`、`database_id`。保留数据库绑定名 `DB`、迁移目录 `migrations`、静态资源配置和兼容标志。使用你账户里的数据库 ID，核对 Wrangler 当前账户后再执行迁移。
3. 将 `ADMIN_EMAIL` 设为自己的登录邮箱，将 `AUTH_ORIGIN` 设为最终访问地址，例如 `https://dashboard.example.com`，地址省略路径及末尾斜杠。生产环境设置 `AUTH_ALLOW_LOCAL_HTTP=0`。换用自定义域名时，同步更新 `AUTH_ORIGIN` 并重新部署。

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create your-database-name
```

把 `your-database-name` 换成 `wrangler.jsonc` 中 `DB` 绑定的 `database_name`，并把返回的 `database_id` 填回配置。使用 [GitHub Actions](./github-actions.md#首次部署数据库自举) 时可启用数据库自举，由工作流按这个名字查找或创建数据库，无需先手工填写 `database_id`。

## 首次部署

在本机手动发布，或选用 [Workers Builds](./cloudflare-builds.md) 与 [GitHub Actions](./github-actions.md) 之一完成第一次发布。

```sh
pnpm build
pnpm deploy:cloudflare
```

部署脚本先应用迁移。若需要单独初始化或在发布前核对数据库，使用：

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

[Cloudflare D1 文档](https://developers.cloudflare.com/d1/get-started/) · [Worker 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 设置运行时 Secret

在 Worker 的 **Settings → Variables and Secrets** 添加 `ADMIN_PASSWORD` 和 `AUTH_RATE_LIMIT_SECRET`。需要保存来源凭据时，再添加独立的 `INTEGRATION_ENCRYPTION_KEY`。可用下面的交互命令填写。生成随机密钥和版本配置见[环境变量](/operations/environment.md)。

```sh
pnpm exec wrangler secret put ADMIN_PASSWORD --config wrangler.jsonc
pnpm exec wrangler secret put AUTH_RATE_LIMIT_SECRET --config wrangler.jsonc
pnpm exec wrangler secret put INTEGRATION_ENCRYPTION_KEY --config wrangler.jsonc
```

打开站点，在 `/login` 登录。修改站点名称并保存，刷新确认数据已持久化。配置一个来源并启用对应模块后，可在首页详情确认采集结果。

## 定时采集

根配置的 `*/5 * * * *` 每五分钟唤起采集。每个来源按自身的刷新间隔检查，到期且被已启用模块使用的来源才会采集。保存影响采集的配置后，更新通常在下一个采集周期开始，失败重试或任务积压可能延长等待。执行情况可从该 Worker 的日志查看。

Cloudflare 使用 Worker 的版本元数据管理采集环境。旧双 Worker 安装迁移后，由站点所有者清理旧 Collector 的 Cron 和构建连接。见[升级与迁移](/operations/migrations.md)。
