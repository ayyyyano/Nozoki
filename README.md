# Nozoki

[English](README_EN.md)

Nozoki 是支持 Cloudflare Workers 和 Node.js 服务器部署的个人看板。Nuxt 4 提供页面与服务端 API。Cloudflare 部署使用 D1，服务器部署使用本机 SQLite 文件保存站点配置、登录会话和数据快照。

界面使用 Varlet Material 3 和 xicons Material，支持动态主题色、横幅或整页背景、纯壁纸模式及加载过渡。管理员通过首页右上角登录入口进入后台，编辑共享配置。

## 看板模块

| 模块     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| DeepSeek | 账户余额、币种及充值余额、赠金余额                        |
| Devices  | Sleepy 设备状态文字、可确认的前台应用、可选电量和供电信息 |
| Codex    | CLIProxyAPI 账户状态及来源提供的被动额度观测              |
| Activity | 每周日程、多时段、模板、日期例外、倒计时和进度            |
| Quotes   | 行情标的管理与供应商接口                                  |
| Links    | 常用链接、排序与 Material 图标                            |
| Services | Uptime Kuma、UptimeFlare 监控状态和延迟                   |

后台可设置模块启停、顺序、标题和访问权限。服务端根据登录身份过滤数据，访客刷新页面时从数据库读取已保存的结果。

数据源需要配置地址、协议版本及凭据。Cloudflare 上的自建来源通过固定 VPC Service 和只读 Relay 访问，Node.js 服务器可以运行内嵌只读 Relay。行情供应商尚未选定，QQQM、VOO 是配置槽位。DeepSeek 余额净变化与官方消费账单分别处理，Codex Token 用量和费用需要可信来源。

## 技术栈

| 技术                                 | 版本    |
| ------------------------------------ | ------- |
| Vue                                  | 3.5.44  |
| Nuxt                                 | 4.6.2   |
| Varlet UI                            | 3.20.7  |
| xicons Material (`@vicons/material`) | 0.13.0  |
| TypeScript                           | 5.9.3   |
| Node.js                              | 24.21.0 |

## 本地启动

```sh
pnpm install --frozen-lockfile
pnpm db:init
pnpm dev
```

访问 http://127.0.0.1:3000。`db:init` 和 `db:migrate` 执行本地 SQL 迁移，日常数据库位于 `.wrangler/state/v3`。缺少数据库绑定或初始化数据时，API 返回服务不可用。

需要本地调试账号时，使用：

```sh
pnpm dev:local
```

登录资料保存在 `.wrangler/local-debug/LOGIN.txt`。首次运行会复制日常数据库，调试期间的数据写入 `.wrangler/local-debug/state/v3`。后续启动继续使用这份数据库和账号。运行开发命令前先停止占用 3000 的服务。

`pnpm dev` 使用已有环境配置。需要固定本地账号时，将 [.dev.vars.example](.dev.vars.example) 复制为 `.dev.vars` 并填写配置；已有文件请直接编辑。

## 管理员配置

| 配置项                   | 用途                                                |
| ------------------------ | --------------------------------------------------- |
| `ADMIN_EMAIL`            | 管理员邮箱                                          |
| `ADMIN_PASSWORD`         | 管理员密码，12～1024 字符                           |
| `AUTH_VERSION`           | 正整数会话版本，修改账号凭据时递增                  |
| `AUTH_ORIGIN`            | 站点完整 origin，如 `https://dashboard.example.com` |
| `AUTH_RATE_LIMIT_SECRET` | 独立随机 32 字节 base64url 密钥                     |
| `AUTH_ALLOW_LOCAL_HTTP`  | 本地 loopback HTTP 开发环境设为 `1`                 |

Cloudflare 本地配置使用 `.dev.vars`，生产密码和辅助密钥使用 Worker Secrets。Node.js 使用受限权限的环境变量文件。`AUTH_ORIGIN` 需要与浏览器访问地址一致，开发服务和本地 Workers 预览分别使用 3000、8787。必填认证配置缺失时，管理员登录不可用，公开看板继续按访客身份提供数据。

首页登录成功后进入 `/admin`，独立登录页为 `/login`。配置保存使用 CSRF 校验、全局版本检查和请求幂等处理。默认会话绝对有效期为 12 小时，空闲期限为 30 分钟；注销会撤销数据库中的会话。

集成凭据使用 `keep`、`replace`、`clear` 操作。替换凭据需要 `INTEGRATION_ENCRYPTION_KEY` 和 `INTEGRATION_KEY_VERSION`。旧密文需要对应版本的密钥，可通过 `INTEGRATION_DECRYPTION_KEYS` 提供历史版本。轮换前请保管这些密钥。

## 构建与预览

```sh
pnpm build
pnpm preview
```

预览地址为 http://127.0.0.1:8787。Dashboard Worker 入口为 `.output/server/index.mjs`，静态资源为 `.output/public`。

Collector 的构建与本地运行：

```sh
pnpm collector:typecheck
pnpm collector:build
pnpm collector:preview
```

Collector 本地地址为 http://127.0.0.1:8788。它通过 Scheduled 事件执行采集，HTTP 请求返回 404。Dashboard 与 Collector 的本地命令共用 `.wrangler/state`；共享数据库还需要一致的 `database_id`。

Nuxt 构建会清理 `.output`，需要在 `pnpm build` 之后构建 Collector。来源采集使用 D1 租约和配置修订检查，失败时保存上次有效快照，并单独记录错误。

## 使用 Agent 工具快速部署

把下面整段提示词发给能在项目目录执行命令的 AI Agent（如 Codex CLI、Claude Code），由它用 wrangler 完成部署，无需在 Cloudflare 控制台手动操作。`wrangler login` 需要在浏览器完成一次授权，其余步骤都在终端进行。本流程不依赖 GitHub；之后想改为推送自动构建，按下一节的第 3～4 步把配置推上 GitHub 并在控制台连接仓库即可。愿意手动操作时，直接跳到下一节。

```text
请把当前目录的 Nozoki 看板部署到 Cloudflare Workers。全程使用命令行，不要打开 Cloudflare 控制台；创建云端资源前先向我确认。开始前先阅读 README.md 的「管理员配置」和「通过 GitHub 部署到 Cloudflare」两节。本流程不需要 git 提交或推送。

准备与检查：
1. 确认 Node.js 24 和 Git 可用，缺少 pnpm 时执行 npm install --global pnpm@12.15.0，然后运行 pnpm install --frozen-lockfile。
2. 向我索取管理员登录邮箱，执行 pnpm exec wrangler login，在浏览器完成授权。

创建云端资源：
3. 执行 pnpm exec wrangler d1 create nozoki-db，把返回的 database_id 写入根目录 wrangler.jsonc，同时在 vars 中把 ADMIN_EMAIL 设为该邮箱。该文件当前是本地占位配置，可整体替换成下一节第 2 步给出的模板。
4. 执行 pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc，在云端数据库创建表结构。

构建与部署：
5. 依次执行 pnpm build 和 pnpm exec wrangler deploy --config wrangler.jsonc，从输出记录 workers.dev 地址。
6. 把该地址作为 AUTH_ORIGIN 加入 wrangler.jsonc 的 vars，再次执行 deploy 命令。
7. 运行 node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" 生成一份密钥，用 pnpm exec wrangler secret put 设为 AUTH_RATE_LIMIT_SECRET。管理员密码向我索取。两个值都通过交互输入或 stdin 传入，不要写入文件、命令行参数或对话输出。
8. 验证部署：请求第 5 步的地址确认看板返回正常，用管理员邮箱和密码登录 /admin，修改站点名称保存并刷新确认生效。完成后向我报告结果和未完成事项。

定时采集（我明确要求时再执行）：
9. 按下一节第 6 步修改 workers/collector/wrangler.jsonc：填入同一个 database_id，删除 remote: false，在顶层 vars 中加入 COLLECTOR_EPOCH=1 和 INTEGRATION_KEY_VERSION=v1。依次执行 pnpm collector:build 和 pnpm exec wrangler deploy --config workers/collector/wrangler.jsonc，再生成一份新的独立密钥，在 nozoki-dashboard 和 nozoki-collector 上用 wrangler secret put 设置相同的 INTEGRATION_ENCRYPTION_KEY。

安全要求：密码和密钥只进入 Worker Secrets 与被 Git 忽略的本地文件，不要提交到仓库，不要在输出或日志中回显。
```

## 通过 GitHub 部署到 Cloudflare

完成下面 1～5 步后，就能打开网站、登录后台并保存设置。第 6 步用于自动采集数据，可以稍后配置。你需要一个 GitHub 账号和一个 Cloudflare 账号，域名可以先使用 Cloudflare 提供的 `workers.dev` 地址。

文中的“本地终端”指你电脑上的 PowerShell、终端或 VS Code 终端。“项目根目录”指包含 `package.json` 和 `wrangler.jsonc` 的文件夹。下载仓库后，余下命令都在这个目录执行。

### 1. 准备自己的仓库和本地工具

在 GitHub 上 Fork 本项目到自己的账号；如果已有完整源码，也可以上传到自己的仓库。安装 [Node.js 24.21.0](https://nodejs.org/download/release/v24.21.0/) 和 [Git](https://git-scm.com/downloads)，重新打开终端，安装 pnpm：

```sh
npm install --global pnpm@12.15.0
```

在自己的仓库页面点击 **Code → HTTPS** 复制地址。将下面的 `YOUR_NAME/nozoki` 替换成自己的仓库路径，再执行：

```sh
git clone https://github.com/YOUR_NAME/nozoki.git nozoki
cd nozoki
pnpm install --frozen-lockfile
```

如果已在本地打开项目，直接在项目根目录执行最后一条安装命令即可。

### 2. 创建云端数据库

打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，选中准备部署的账号，在 **Storage & databases（存储与数据库）→ D1 SQL Database** 中创建名为 `nozoki-db` 的数据库。打开数据库详情，复制 **Database ID**，它是一串类似 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 的标识。

用编辑器打开项目根目录的 [wrangler.jsonc](wrangler.jsonc)。首次部署可以将文件内容替换成下面的配置，填写刚才的 Database ID 和自己的登录邮箱：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "nozoki-dashboard",
  "main": ".output/server/index.mjs",
  "compatibility_date": "2026-10-19",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "assets": {
    "directory": ".output/public",
    "binding": "ASSETS",
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "nozoki-db",
      "database_id": "替换为你的 Database ID",
      "migrations_dir": "migrations",
    },
  ],
  "vars": {
    "ADMIN_EMAIL": "替换为你的登录邮箱",
    "AUTH_VERSION": "1",
    "AUTH_ALLOW_LOCAL_HTTP": "0",
  },
}
```

`ADMIN_EMAIL` 是登录时填写的账号，不会发送邮件。仓库中的 Database ID 是仅用于本地开发的占位值，云端部署时需要替换。已有自定义域名或其他部署配置时，按上述字段合并修改。

### 3. 初始化数据库并推送配置

在本地终端执行：

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

第一条命令会打开浏览器，登录并授权刚才创建数据库的 Cloudflare 账号。第二条命令在云端数据库中创建所需表结构，检查显示的目标为 `nozoki-db`，出现执行确认时输入 `y`。看到迁移成功后，将配置提交到自己的 GitHub 仓库：

```sh
git add wrangler.jsonc
git commit -m "Configure Cloudflare deployment"
git push origin main
```

以上使用 `main` 分支，仓库使用其他分支名时按实际修改。也可以用 GitHub Desktop 提交并推送。数据库内容保存在 Cloudflare，不会随这些命令上传到 GitHub。

### 4. 在 Cloudflare 导入仓库

在 Cloudflare 控制台打开 **Workers & Pages → Create application（创建应用）→ GitHub**，授权读取自己的仓库，选中刚才推送的项目。使用 Workers 的仓库部署入口，填写：

| 设置        | 填写内容                                               |
| ----------- | ------------------------------------------------------ |
| Worker 名称 | `nozoki-dashboard`，与 `wrangler.jsonc` 的 `name` 相同 |
| 生产分支    | `main`，或自己的实际分支                               |
| 根目录      | 仓库根目录，保留默认值                                 |
| 构建命令    | `pnpm build`                                           |
| 部署命令    | `pnpm exec wrangler deploy --config wrangler.jsonc`    |

项目已通过 `.node-version` 和 `package.json` 固定 Node.js、pnpm 版本。如控制台要求手动指定，在 **Build variables（构建变量）** 中填写 `NODE_VERSION=24.21.0`、`PNPM_VERSION=12.15.0`。Cloudflare 部署使用 `pnpm build`，服务器版的 `build:node` 留给自部署使用。

点击 **Save and Deploy（保存并部署）**，等待构建成功。打开提供的 `https://nozoki-dashboard.你的子域名.workers.dev` 地址。这时应能看到看板，管理员登录将在下一步启用。

### 5. 设置登录地址和密码

先复制网站的完整 HTTPS 地址，在本地 `wrangler.jsonc` 的 `vars` 中补充 `AUTH_ORIGIN`，保留自己的登录邮箱，例如：

```jsonc
"vars": {
  "ADMIN_EMAIL": "you@example.com",
  "AUTH_VERSION": "1",
  "AUTH_ALLOW_LOCAL_HTTP": "0",
  "AUTH_ORIGIN": "https://nozoki-dashboard.your-subdomain.workers.dev"
}
```

地址填写到域名为止，末尾不加 `/`，也不加 `/admin`。提交并推送这个修改，Cloudflare 会自动重新部署。

然后在本地终端生成一个登录安全密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

回到 Cloudflare，打开 **Workers & Pages → nozoki-dashboard → Settings → Variables and Secrets**。点击 **Add**，类型选择 **Secret**，分别添加：

| 名称                     | 值                                   |
| ------------------------ | ------------------------------------ |
| `ADMIN_PASSWORD`         | 自己设置的管理员密码，至少 12 个字符 |
| `AUTH_RATE_LIMIT_SECRET` | 上一条命令输出的完整字符串           |

点击 **Deploy** 使密钥生效。这里使用的是 Worker 的运行时设置，构建页面的 **Build variables and secrets** 只在构建期间可用。密码和密钥填写在 Secret 中，不要写进 `wrangler.jsonc` 或 GitHub。

打开网站，点击右上角账号图标，使用 `ADMIN_EMAIL` 和刚才设置的密码登录。进入后台后修改站点名称并保存，刷新页面确认设置仍在，即可开始使用。还没有配置来源时，设备、余额等模块会显示未配置状态。

### 6. 配置数据凭据与自动采集

需要在后台保存 API Key 时，再运行一次上面的随机密钥命令，生成独立的加密密钥。在 `nozoki-dashboard` 的运行时 Secrets 中添加 `INTEGRATION_ENCRYPTION_KEY`，并在根目录 `wrangler.jsonc` 的 `vars` 中添加 `"INTEGRATION_KEY_VERSION": "v1"`，随后推送修改。将这个密钥保存在密码管理器中，遗失后将无法解密已保存的凭据。

Collector 是负责定时采集的第二个 Worker，也负责清理过期会话和旧日志。准备启用时，打开 [workers/collector/wrangler.jsonc](workers/collector/wrangler.jsonc)：

- 将 `database_id` 替换为第 2 步创建的同一个 Database ID。
- 删除该 D1 配置中的 `"remote": false`。
- 在文件最外层添加 `"vars": { "COLLECTOR_EPOCH": "1", "INTEGRATION_KEY_VERSION": "v1" }`。已有 `vars` 时将这两个字段加进去。

先在本地终端发布 Collector：

```sh
pnpm exec wrangler deploy --config workers/collector/wrangler.jsonc
```

该命令会启用配置中的每五分钟 Cron。它按来源各自的刷新间隔采集，关闭的来源和未被启用模块引用的来源会跳过。在 Cloudflare 的 `nozoki-collector → Settings → Variables and Secrets` 中添加同名 Secret `INTEGRATION_ENCRYPTION_KEY`，值与 Dashboard 中的加密密钥相同，点击 **Deploy**。Collector 不需要管理员登录密码。

需要随 GitHub 推送更新 Collector 时，将修改后的 Collector 配置也提交到仓库，然后打开 `nozoki-collector → Settings → Builds → Connect`，连接同一仓库。根目录仍选仓库根目录，构建命令填写 `pnpm collector:build`，部署命令填写 `pnpm exec wrangler deploy --config workers/collector/wrangler.jsonc`。

Collector 的网页地址返回 404 是正常行为。采集结果在看板显示，执行情况可在该 Worker 的日志中查看。DeepSeek 需要自己的 API Key；Sleepy、CLIProxyAPI、Kuma 和 Flare 还需要固定 VPC Service 与只读 Relay，部署 Collector 不会自动连接家中或局域网的服务。更改采集密钥、Relay 路由或绑定修订时，递增 `COLLECTOR_EPOCH` 后发布。

### 后续更新与常见问题

平时推送代码到生产分支，已连接的 Worker 会自动构建部署。若更新包含新的 `migrations/*.sql`，先在本地运行第 3 步的迁移命令，再部署新代码；迁移器会跳过已经执行的文件。迁移前可在 D1 数据库详情中查看 Time Travel 或导出备份。自定义域名启用后，也要将 `AUTH_ORIGIN` 更新为实际访问的 HTTPS 地址。

| 现象                              | 检查位置                                                                    |
| --------------------------------- | --------------------------------------------------------------------------- |
| 构建提示 Worker 名称不一致        | 控制台 Worker 名称与本次部署配置的 `name` 是否相同                          |
| 构建提示 Node 或 pnpm 版本不支持  | Build variables 中的版本；构建命令是否为 `pnpm build`                       |
| 首页接口返回 503 或提示存储不可用 | Database ID 是否正确、云端迁移是否完成、Worker 的 `DB` 是否绑定 `nozoki-db` |
| 登录提示“暂时无法登录”            | `AUTH_ORIGIN` 与地址栏是否一致、两个登录 Secret 是否添加在运行时设置中      |
| 绑定自定义域名后无法登录          | `AUTH_ORIGIN` 是否已改为自定义域名并重新部署；改前通过 `workers.dev` 地址之外的自定义域名访问时，任何密码都会被拒绝 |
| 登录提示“邮箱或密码错误”          | 登录邮箱是否与 `ADMIN_EMAIL` 相同，密码是否与 Secret 中设置的值相同         |
| 数据源显示未配置或目标未批准      | 后台来源配置及固定 Relay 设置，这类状态需要按来源补充配置                   |

控制台操作参考 Cloudflare 的 [Git 仓库部署](https://developers.cloudflare.com/workers/ci-cd/builds/)、[D1 数据库](https://developers.cloudflare.com/d1/get-started/) 和 [Secret 设置](https://developers.cloudflare.com/workers/configuration/secrets/) 文档。

## 服务器自部署

需要 Node.js 24.21.0、pnpm 和可持久写入的本地磁盘。SQLite 使用 Node.js 内置的 `node:sqlite`，无需安装数据库服务。服务器构建输出为 `.output-node/`，Cloudflare 的 `pnpm build` 继续输出到 `.output/`。

### 构建与启动

```sh
pnpm install --frozen-lockfile
pnpm build:node
cp .env.example .env
```

编辑 [.env.example](.env.example) 对应的 `.env`，填写管理员配置。`NOZOKI_SQLITE_PATH` 必须是数据文件的绝对路径，例如 `/var/lib/nozoki/nozoki.sqlite`，该目录由运行账号持有。密码和随机密钥请分别生成。`.env` 和数据库文件已列入 Git 忽略规则。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm db:migrate:node
pnpm start:node
```

默认监听 `127.0.0.1:3000`。本机 HTTP 调试时，将 `AUTH_ORIGIN` 设为 `http://127.0.0.1:3000`，并设置 `AUTH_ALLOW_LOCAL_HTTP=1`。正式使用时填写 HTTPS origin，设置 `AUTH_ALLOW_LOCAL_HTTP=0`。

可将完整 `.output-node/` 复制到服务器，使用 Node.js 直接运行，路径相对构建产物解析：

```sh
node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/database.mjs migrate
node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/start.mjs
```

运行账号需要读取构建产物和密钥文件，并写入数据库目录。将密钥文件权限设为 `600`。更新程序时保留数据库及其所在目录，数据库应位于发布目录之外。首次迁移创建独立的 SQLite 数据库；已有 D1 数据需要单独导出和转换，启动脚本不会自动导入。

### HTTPS 与进程管理

Node 服务绑定 loopback，由同机 Caddy 或 Nginx 提供 HTTPS。反向代理必须保留浏览器请求的 Host，与 `AUTH_ORIGIN` 中的主机名及端口一致。Caddy 示例：

```caddyfile
dashboard.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

认证使用配置中的 HTTPS origin 判断请求目标。`X-Forwarded-Host`、`X-Forwarded-Proto`、`X-Forwarded-For` 和 `CF-Connecting-IP` 均不作为身份或来源证明。Node 部署的来源限流使用保守的共享桶，管理员账号限流仍独立生效。公开 HTTPS 会话使用 Secure、HttpOnly、SameSite=Strict 的 `__Host-nozoki_session` Cookie。

Linux 可以用 systemd 管理服务。创建运行账号 `nozoki`，赋予数据目录权限，再按实际 Node 路径及安装目录填写 `/etc/systemd/system/nozoki.service`：

```ini
[Unit]
Description=Nozoki dashboard
After=network-online.target

[Service]
User=nozoki
WorkingDirectory=/opt/nozoki
EnvironmentFile=/etc/nozoki/nozoki.env
ExecStart=/usr/bin/node /opt/nozoki/.output-node/start.mjs
Restart=on-failure
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

### 采集与私有来源

单次采集运行：

```sh
pnpm collector:node
```

网页进程和采集进程使用相同的 `NOZOKI_SQLITE_PATH`、集成解密密钥及 Relay 配置。`COLLECTOR_EPOCH` 为正整数；更改采集密钥、Relay 路由或绑定修订时递增。每次命令按五分钟窗口检查到期来源，D1 版本的租约、修订检查、退避及提交守卫同样用于 SQLite。

需要自动采集时，由运行账号添加系统 Cron，环境文件及路径按实际情况填写：

```cron
*/5 * * * * /usr/bin/node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/collector.mjs
```

采集命令同时执行有界的小时级清理。部署包不会自行安装或启用定时任务。固定 DeepSeek 官方目标可以直接读取；其他来源默认拒绝出站，需由服务器管理员配置静态只读 Relay。

内嵌 Relay 使用 `NOZOKI_RELAY_CONFIG_FILE` 指向受限权限的 JSON 文件，格式为 `{"sources":[{"source":{...},"credential":"..."}]}`。`source` 包含 `id`、`provider`、`protocolVersion`、规范化 HTTPS `baseUrl`、`enabled`、`refreshInterval`、`fieldMappings`、`capabilities` 和 `credentialState`，采用已有 IntegrationSettings 校验。上游管理密钥放在 `credential`，它只供 Relay 使用。`NOZOKI_PRIVATE_ROUTES` 中登记同一来源的 `id`、`provider`、`protocolVersion`、`baseUrl`、`refreshInterval`、`fieldMappings`。路由必须与 D1/SQLite 中已保存的配置一致。还需配置独立的 `NOZOKI_PRIVATE_RELAY_TOKEN` 和 `COLLECTOR_BINDING_REVISION`。Codex 账户协议另外需要稳定的 `NOZOKI_RELAY_ID_KEY`，其 SHA-256 十六进制摘要填入对应路由的 `identityVersion`。

内嵌 Relay 在进程内处理固定请求，不监听额外 HTTP 端口。它使用正常的 TLS 证书校验，来源仍限于已注册的只读路径。未配置 Relay 时，Sleepy、CLIProxyAPI、Kuma 和 Flare 返回受限状态。

### 数据备份与升级

```sh
pnpm db:backup:node /var/backups/nozoki/manual.sqlite
```

备份使用 SQLite online backup，并以 `quick_check` 验证；目标文件必须尚不存在。升级时先备份，停止网页服务与采集任务，替换程序，运行 `db:migrate:node` 后重新启动。迁移使用同一套 `migrations/` SQL，逐文件事务执行并记录 SHA-256。已有数据库存在待执行迁移时，会先写入一致性备份，默认放在数据文件同级的 `backups/`，可通过 `NOZOKI_BACKUP_DIR` 调整。

恢复时先停掉两个进程，将完整备份恢复到新的数据路径，再更新 `NOZOKI_SQLITE_PATH`。正在写入的数据库应通过备份命令复制。数据库、WAL 及共享内存文件位于同机本地磁盘，容器部署需要挂载持久数据卷。当前适合单机运行；SQLite 写入使用 WAL、FULL 同步和一秒锁等待，持续写入拥堵时请求会失败并回滚。

## 项目结构

```text
app/                 Vue 页面、组件、样式与 composable
server/              API、认证、配置服务、Repository、适配器和采集编排
shared/
  contracts/         运行时数据校验与共享类型
  schedule/          可独立导入的日程引擎
  device-state/      设备状态与电量解析
  collection/        采集时间与结果规则
  domain/            余额计算及展示数据转换
workers/collector/   独立采集 Worker
platform/node/       Node HTTP 入口、SQLite、迁移和单次采集入口
migrations/          D1 与服务器 SQLite 共用的 SQL 迁移
scripts/             构建、本地运行与资源生成脚本
tools/               本地只读 Relay
tests/               单元、D1、浏览器与独立移植测试
public/              静态资源、字体和第三方声明
.dev.vars.example    本地环境变量模板
.env.example         服务器环境变量模板
.gitignore           本地文件和构建产物的忽略规则
.gitattributes       文本换行规则
```

## 开发检查

按修改范围运行需要的命令：

```sh
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
pnpm test:d1
```

`test:d1` 自动构建 Collector，并使用隔离的本地 workerd/D1。浏览器测试需要已启动的本地服务，默认使用 Microsoft Edge，可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定其他浏览器。

服务器专项测试先运行 `pnpm build:node`，再运行 `pnpm test:node`。测试使用隔离 SQLite，覆盖事务、跨连接 CAS、采集租约、认证、CSRF、HTTP 幂等、重启恢复和浏览器保存。

```sh
pnpm test:browser
pnpm test:sliders
pnpm test:dx
```

`pnpm theme:generate` 生成 M3 默认色板，`pnpm dx:generate` 生成早期加载脚本。开发和构建命令会调用相应的准备步骤。

## 许可证

项目代码采用 [MIT 许可证](LICENSE)。第三方许可证见 [public/licenses/](public/licenses/)。

加载动画：[maimai-transition](https://github.com/gfdfdxc/maimai-transition)。
