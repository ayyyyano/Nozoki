# Nozoki

[English](README_EN.md)

Nozoki 是支持 Cloudflare Workers 和 Node.js 服务器部署的个人看板。Nuxt 4 提供页面与服务端 API。Cloudflare 部署使用 D1，服务器部署使用本机 SQLite 文件保存站点配置、登录会话和数据快照。

界面使用 Varlet Material 3 和 xicons Material，支持动态主题色、横幅或整页背景、纯壁纸模式及加载过渡。管理员通过首页右上角登录入口进入后台，编辑共享配置。

## 看板模块

| 模块      | 内容                                                      |
| --------- | --------------------------------------------------------- |
| DeepSeek  | 当前余额与近 7 日剩余余额柱状图，可为访客模糊展示         |
| Devices   | Sleepy 设备状态文字、可确认的前台应用、可选电量和供电信息 |
| Tailscale | 设备名称、控制面连接状态及可按登录身份隐藏的 Tailnet IP   |
| Codex     | CLIProxyAPI 账户状态及来源提供的被动额度观测              |
| Activity  | 每周日程、多时段、模板、日期例外、倒计时和进度            |
| Quotes    | 腾讯行情、日涨跌、成交量与 5 日走势                       |
| Links     | 常用链接、排序与 Material 图标                            |
| Services  | Uptime Kuma、UptimeFlare 监控状态和延迟                   |

后台可设置模块启停、顺序、标题和访问权限。服务端根据登录身份过滤数据，访客刷新页面时从数据库读取已保存的结果。

DeepSeek 自动匹配余额来源。今日余额随采集更新，历史柱取站点时区内当天最后一次成功观测；未采集的日期留空。现有定时任务会在日终前安排一次采集，服务中断或上游失败时无法保证取得日终余额。后台「Dashboard 模块 → DeepSeek」可开启「未登录时模糊展示余额」；访客仅收到占位数据，登录后按字段权限显示真实余额。

后台管理数据源的地址、协议、凭据和访问批准。Cloudflare Workers 直接读取在后台批准的公网 HTTPS 来源。Node.js 部署使用内嵌连接器。QQQM、VOO 默认使用已启用的腾讯来源。Codex 展示账户状态及可确认的被动配额。

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

网页、API 和定时采集使用同一个 Worker。根配置中的 Cron 每五分钟调用独立的采集引擎，来源仍按各自刷新间隔更新。预览时可打开 `http://127.0.0.1:8787/cdn-cgi/handler/scheduled` 手动触发；这一路径由本地 Wrangler 提供，线上没有公开采集入口。

采集使用数据库租约和来源修订检查。失败时保留上次有效快照，错误单独记录。

## 使用 Agent 工具快速部署

把下面整段提示词发给能在项目目录执行命令的 AI Agent（如 Codex CLI、Claude Code），由它用 wrangler 完成首次部署，并把 Worker 绑定到你的 GitHub 仓库，此后推送代码即自动构建部署。`wrangler login` 需要在浏览器完成一次授权；绑定 Git 仓库需要你在 Cloudflare 控制台做一次连接确认（含 GitHub App 授权），其余步骤都在终端进行。愿意手动操作时，直接跳到下一节。

```text
请把当前目录的 Nozoki 看板部署到 Cloudflare Workers，并默认把 Worker 绑定到我的 GitHub 仓库，此后通过推送自动构建。除最后的 Git 绑定一步需要我在控制台确认外，其余全程使用命令行，不要打开 Cloudflare 控制台；创建云端资源前先向我确认。开始前先阅读 README.md 的「管理员配置」和「通过 GitHub 部署到 Cloudflare」两节。本流程需要把部署配置提交推送到我的仓库。

准备与检查：
1. 确认 Node.js 24 和 Git 可用，缺少 pnpm 时执行 npm install --global pnpm@12.15.0，然后运行 pnpm install --frozen-lockfile。
2. 向我索取管理员登录邮箱，执行 pnpm exec wrangler login，在浏览器完成授权。

创建云端资源：
3. 执行 pnpm exec wrangler d1 create nozoki-db，把返回的 database_id 写入根目录 wrangler.jsonc，同时在 vars 中把 ADMIN_EMAIL 设为该邮箱。该文件当前是本地占位配置，可整体替换成下一节第 2 步给出的模板。
4. 执行 pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc，在云端数据库创建表结构。

构建与部署：
5. 依次执行 pnpm build 和 pnpm deploy:cloudflare，从输出记录 workers.dev 地址。
6. 把该地址作为 AUTH_ORIGIN 加入 wrangler.jsonc 的 vars，再次执行 deploy 命令。
7. 运行 node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" 生成一份密钥，用 pnpm exec wrangler secret put 设为 AUTH_RATE_LIMIT_SECRET。管理员密码向我索取。两个值都通过交互输入或 stdin 传入，不要写入文件、命令行参数或对话输出。
8. 验证部署：请求第 5 步的地址确认看板返回正常，用管理员邮箱和密码登录 /admin，修改站点名称保存并刷新确认生效。完成后向我报告结果和未完成事项。

绑定 Git 自动构建：
9. 执行 git remote -v 确认远端仓库；没有远端时向我索取仓库地址。将部署配置提交并推送到生产分支（默认 master）。引导我打开 nozoki-dashboard → Settings → Builds → Connect，选择该仓库与生产分支，根目录使用仓库根目录，构建命令填写 pnpm build，部署命令填写 pnpm deploy:cloudflare。只需连接这一个 Worker，此后推送会一起更新网页和定时采集。

数据凭据加密（我明确要求时再执行）：
10. 生成一份独立的随机 32 字节 base64url 密钥，用 pnpm exec wrangler secret put INTEGRATION_ENCRYPTION_KEY 配置到主 Worker。INTEGRATION_KEY_VERSION 使用配置中的 v1。密钥只通过交互输入或 stdin 传入，提醒我保存在密码管理器中。网页保存和定时采集共用这一份密钥。已有加密凭据时需使用原密钥。

定时采集：
11. 定时采集随主 Worker 的 Cron 启用，无需部署第二个 Worker。检查该 Worker 的定时触发器为 */5 * * * *，在后台接入来源并启用对应模块后，保存会安排采集，Cron 继续定时刷新。

安全要求：密码和密钥只进入 Worker Secrets 与被 Git 忽略的本地文件，不要提交到仓库，不要在输出或日志中回显。
```

## 通过 GitHub 部署到 Cloudflare

完成下面 1～5 步后，就能打开网站、登录后台并保存设置，默认行情由同一 Worker 定时采集。第 6 步用于保存其他来源的加密凭据，可以稍后配置。你需要一个 GitHub 账号和一个 Cloudflare 账号，域名可以先使用 Cloudflare 提供的 `workers.dev` 地址。

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
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "workers_dev": true,
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "triggers": { "crons": ["*/5 * * * *"] },
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
    "INTEGRATION_KEY_VERSION": "v1",
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
git push origin master
```

以上使用 `master` 分支，仓库使用其他分支名时按实际修改。也可以用 GitHub Desktop 提交并推送。数据库内容保存在 Cloudflare，不会随这些命令上传到 GitHub。

### 4. 在 Cloudflare 导入仓库

在 Cloudflare 控制台打开 **Workers & Pages → Create application（创建应用）→ GitHub**，授权读取自己的仓库，选中刚才推送的项目。使用 Workers 的仓库部署入口，填写：

| 设置        | 填写内容                                               |
| ----------- | ------------------------------------------------------ |
| Worker 名称 | `nozoki-dashboard`，与 `wrangler.jsonc` 的 `name` 相同 |
| 生产分支    | `master`，或自己的实际分支                             |
| 根目录      | 仓库根目录，保留默认值                                 |
| 构建命令    | `pnpm build`                                           |
| 部署命令    | `pnpm deploy:cloudflare`                               |

项目已通过 `.node-version` 和 `package.json` 固定 Node.js、pnpm 版本。如控制台要求手动指定，在 **Build variables（构建变量）** 中填写 `NODE_VERSION=24.21.0`、`PNPM_VERSION=12.15.0`。Cloudflare 部署使用 `pnpm build`，服务器版的 `build:node` 留给自部署使用。

点击 **Save and Deploy（保存并部署）**，等待构建成功。打开提供的 `https://nozoki-dashboard.你的子域名.workers.dev` 地址。这时应能看到看板，管理员登录将在下一步启用。

部署命令使用 `pnpm deploy:cloudflare`，它先应用 D1 待执行迁移，再发布包含网页和采集入口的 Worker。迁移失败时停止发布。Cloudflare Builds 的部署 Token 需要该数据库的 **D1 Edit** 权限。`pnpm build` 仅构建，本身不会访问云端数据库。

若代码已更新但数据库还停留在完整的七模块旧结构，服务会在首次配置读取时检测并降级为只读：继续展示已有配置及合法快照，后台提示等待迁移，禁止保存、测试来源及定时采集。执行 `pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc` 后刷新即可恢复，无需重启 Worker。该兼容仅用于迁移 0016 前的完整旧结构；空库、损坏结构不会被默认数据覆盖。迁移仍由发布流程执行，不由访客请求执行。

### 5. 设置登录地址和密码

先复制网站的完整 HTTPS 地址，在本地 `wrangler.jsonc` 的 `vars` 中补充 `AUTH_ORIGIN`，保留自己的登录邮箱，例如：

```jsonc
"vars": {
  "ADMIN_EMAIL": "you@example.com",
  "AUTH_VERSION": "1",
  "AUTH_ALLOW_LOCAL_HTTP": "0",
  "AUTH_ORIGIN": "https://nozoki-dashboard.your-subdomain.workers.dev",
  "INTEGRATION_KEY_VERSION": "v1"
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

### 6. 配置数据凭据与定时采集

腾讯默认行情不需要 API Key。需要在后台保存其他来源的凭据时，运行第 5 步的随机密钥命令，生成独立的加密密钥。在 **nozoki-dashboard → Settings → Variables and Secrets** 中添加 Secret `INTEGRATION_ENCRYPTION_KEY`，点击 **Deploy**。根配置已设置 `INTEGRATION_KEY_VERSION=v1`。将密钥保存在密码管理器中，遗失后无法解密已有凭据。

网页保存、只读测试和定时采集共用此 Worker 的 D1 与 Secrets。配置中的 `*/5 * * * *` Cron 每五分钟执行一次，关闭的来源及未被启用模块引用的来源会跳过。执行情况在该 Worker 的日志中查看。

采集环境按 [Cloudflare 部署版本](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)自动更新，添加加密密钥或发布代码后无需手动设置 `COLLECTOR_EPOCH`。已有双 Worker 安装应关闭或删除旧 `nozoki-collector` 的 Cron 与 Git 构建，避免它继续运行。回滚代码时请重新构建并发布目标版本，采集会拒绝比当前记录更旧的部署。

### 在后台接入自建来源

1. 打开「数据源 → 添加来源」，选择 DeepSeek、Sleepy、CLIProxyAPI 或其他已支持的类型。每种类型可添加一个实例，已添加的类型会在对话框中标记。
2. 在配置对话框填写实例 HTTPS 地址和所需凭据。Sleepy 地址例如 `https://alive.example.com/`；DeepSeek 填写 API Key，CLIProxyAPI 填写 Management Key。腾讯行情已在新安装中预置。
3. 点击「测试并确认访问」。这一步会访问填写的服务并校验协议及认证。测试通过后点击「添加来源」，来源会加入当前草稿。限流、超时或协议不匹配时，可修正配置后重试。
4. 点击顶栏「保存配置」。对应的 Dashboard 模块会自动匹配来源，保存后安排采集。模块是否展示仍由模块开关和访客权限决定。测试本身仅返回连接结果，正式数据由采集器保存。

测试凭证有效期为 10 分钟，绑定当前登录会话、配置版本、来源类型、地址、认证方式、连接参数和凭据。修改地址或凭据后需要重新测试；过期后也需重测。配置被其他窗口更新时，先读取最新版本再处理草稿。更换地址会清除草稿中的旧批准，新目标通过测试并保存后生效。已保存的密钥仅在来源身份、协议、地址和认证方式一致时复用。

| 来源类型                 | 自动匹配模块                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| DeepSeek                 | DeepSeek                                                         |
| Sleepy                   | 设备                                                             |
| Tailscale                | Tailscale                                                        |
| CLIProxyAPI              | Codex                                                            |
| Uptime Kuma、UptimeFlare  | 服务状态，两个来源可同时展示                                     |
| 腾讯、Yahoo | 自选行情，已启用的腾讯优先；腾讯未配置或停用时选择 Yahoo |

日程安排和常用链接使用本站配置。行情标的跟随当前行情来源；来源发生临时限流或请求失败时保持当前选择。监控来源分别采集，合并时使用各条目的稳定 ID；部分来源失败时显示不可用提示及已经取得的数据。

重置数据源不会重新添加已删除的来源；需要时请按上述流程重新测试并添加。

后台显示类型名称，内部 ID 用于加密、历史记录和快照关联。已有 ID、密钥和历史记录保持关联；同类型的多个历史实例会保留，添加对话框禁止继续增加该类型。旧实例的自动选择优先采用已启用的现有引用。跨来源重复配置的同一行情标的保持各自记录，可在「行情标的」移除重复项后统一匹配。未登记的历史协议保留原有引用供只读兼容。

来源创建后类型和协议固定。密钥输入区的星号是占位符，点击「编辑」填写新值。点击删除图标并确认后，凭据会在全局保存时清除；保存前可以撤销。每份配置最多 10 个来源。删除来源会自动解除模块匹配，受保护的余额和导入历史仍会阻止删除，此时可停用来源。

Sleepy、Kuma、Flare 使用各自支持的只读协议。CLIProxyAPI 选择 `cliproxy-bridge` / `cliproxy-v8-accounts`，使用 Management Key 作为 Bearer 凭据。账户身份密钥自动生成并加密保存。建议用反向代理仅开放该协议读取的 `v8/management/credentials` 端点。后台不能将任意 URL 当作自定义协议调用。

### Cloudflare 公网 HTTPS 出站

Worker 使用 `fetch` 读取已批准的来源，无需额外服务器、连接器密钥或逐来源 Worker 变量。`https://alive.example.com/` 这类自建公网服务也适用。

根配置包含 `global_fetch_strictly_public`。它让同一 Cloudflare zone 下的请求经过域名的公开入口，遵守目标的 Workers 路由和安全规则。请保留此标志。目标若有登录页、Cloudflare Access 或交互验证，需要为只读 API 配置合适的访问规则；采集器无法完成浏览器验证。

请求限定为批准的 HTTPS 443 服务根目录。数据采集使用已登记的 GET 端点，Tailscale 令牌交换使用固定官方 POST 端点。请求不携带浏览器 Cookie，Bearer 凭据按来源发送，重定向会被拒绝。响应上限为 128KB，普通来源超时 3.5 秒，行情来源超时 10 秒。域名解析后的私网地址由 Workers 网络层在连接时过滤，应用同时拒绝 IP 字面量、回环域名和本地域名。[workerd 网络规则](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp)和 [Cloudflare 公开路由标志](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)说明了这些平台行为。

发布前由部署脚本应用数据库迁移。公网来源的日常增删、批准和凭据修改在后台保存后生效。

后台来源统一使用公网 HTTPS。私网 IP、仅局域网解析的地址和 Tailscale 内网地址需要先通过可信的公网 HTTPS 服务提供受支持的只读 API。Node.js 在连接时解析并固定公网 IP，校验 TLS 证书。

### 已有来源迁移

部署命令会应用 `0019_public_sources.sql`。旧内置 DeepSeek、腾讯、Yahoo 双镜像和 Tailscale 来源，只有 Provider、协议与官方根地址精确匹配时才会自动转成后台批准。迁移保留来源 ID、加密凭据、模块引用、行情绑定和历史数据，配置版本递增。升级前打开的后台草稿需要重新读取。

其他旧来源会暂停采集，并保留配置供管理员确认。在「数据源」核对公网实例地址、补齐凭据，点击「确认来源访问」并保存。旧协议无法识别时，页面显示只读提示，需要新建受支持的来源。旧 `NOZOKI_PUBLIC_ROUTES`、`NOZOKI_PRIVATE_ROUTES` 与 Relay 路由不再授权生产采集，完成迁移后可清理这些变量及 Relay 配置。

添加 CLIProxyAPI 来源后填写 Management Key。若旧 Relay 存放过 Management Key，需要在后台重新填写。已有按账户 ID 配置的权限时，打开「迁移已有账户权限」，在「原账户身份密钥（迁移时填写）」填入原 `NOZOKI_RELAY_ID_KEY`。保存会只读获取账户并核对 ID；密钥不匹配、目标不可达或原账户已删除时，保存被拒绝，请核实密钥和账户权限。身份密钥加密保存，页面只显示是否已配置。新来源可留空，系统自动生成身份密钥。

### Tailscale 设备列表

Tailscale 与 Sleepy 是独立模块。Tailscale 默认关闭，默认排序在 Devices 与 Codex 之间。

1. 在 Tailscale 的 Trust credentials 中创建 OAuth Client，仅授予 `devices:core:read`。
2. 后台「数据源 → 添加来源」选择 Tailscale，填写 OAuth Client ID 和 Client Secret，点击「测试并确认访问」。测试通过后添加来源，再点击全局「保存配置」。官方地址和认证方式由预设填入。
3. 在「Dashboard 模块」启用 Tailscale，来源会自动匹配。需要向访客展示设备时，将模块权限设为公开。
4. IP 可以选择「显示」「不显示」「登录后显示」，默认登录后显示。无权查看时仍保留设备和 IP 行，以 `****` 代替地址；真实地址不会发送给该访问者。

在线状态来自 `connectedToControl`，表示 Tailscale 控制面连接状态，不保证设备上的服务可达。接口不提供前台应用或电量；这些信息继续由 Sleepy 提供。Collector 访问官方 API，无需加入 Tailnet。每轮先向固定官方 `/api/v2/oauth/token` 端点 POST 换取只读令牌，再 GET 设备列表，共两次请求。Client Secret 仅发给该官方令牌端点，重定向会被拒绝。

### 默认腾讯行情

新数据库自动加载来源 `tencent`：Provider 为 `quotes-custom`，协议为 `tencent-us-v1`，服务根地址为 `https://web.ifzq.gtimg.cn/`。来源已启用，每 300 秒检查刷新；QQQM、VOO 和行情模块的 `main` 引用均已绑定。默认来源已保存等价的后台批准，无需 API Key 或额外 Worker 变量。

1. 使用本文部署命令应用数据库迁移，默认配置会加载腾讯来源。
2. 已有站点缺少 `tencent` 时，迁移会自动加载腾讯默认来源，将 QQQM/VOO 的默认 Yahoo 绑定和行情模块的默认 Yahoo 引用切换到腾讯。Yahoo 若已无其他启用引用，会被关闭；其凭据、快照和退避记录仍保留。已有同名来源、其他自定义绑定或达到 10 个来源上限的配置保持原状。配置变更会递增版本并记录系统审计，升级前打开的后台草稿需要重新读取。
3. 可先执行只读连接测试，再等待 Collector 调度。测试读取一个标的；看板使用 Collector 保存的结果。Node.js 部署可执行 `pnpm collector:node`。

腾讯协议目前支持美股。默认的 `US / QQQM`、`US / VOO` 分别使用来源返回的完整代码 `QQQM.OQ`、`VOO.AM`。其他标的需填写已核实的完整代码（如 `AAPL.OQ`），裸代码不会自动猜测交易所，A 股及港股尚未接入此协议。每标的一次请求，同时取得报价和五日历史，单来源最多 20 个标的，总读取时间受 10 秒上限约束。

日涨跌按响应中的昨收计算，金额保存为十进制字符串。美股报价时间按 `America/New_York` 转为 UTC，页面再按站点时区显示。五日走势使用前复权收盘价，历史日期以纽约当地零点记录日期位置，报价观测时间使用独立的上游时间。已知的延迟分钟数显示在卡片底部。休市旧数据会标记过期，失败时保留最后合法快照。

这是腾讯自选股页面使用的未版本化端点，公开展示权利尚未确认。Yahoo 支持 `yahoo-chart-v8` 协议与两个镜像；腾讯未配置或停用时自动匹配 Yahoo。临时采集失败不触发切换。来源授权由后台保存的目标批准决定。

### 后续更新与常见问题

平时推送代码到生产分支，已连接的 Worker 会自动构建部署。若更新包含新的 `migrations/*.sql`，先在本地运行第 3 步的迁移命令，再部署新代码；迁移器会跳过已经执行的文件。迁移前可在 D1 数据库详情中查看 Time Travel 或导出备份。自定义域名启用后，也要将 `AUTH_ORIGIN` 更新为实际访问的 HTTPS 地址。

| 现象                              | 检查位置                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 构建提示 Worker 名称不一致        | 控制台 Worker 名称与本次部署配置的 `name` 是否相同                                                                  |
| 构建提示 Node 或 pnpm 版本不支持  | Build variables 中的版本；构建命令是否为 `pnpm build`                                                               |
| 首页接口返回 503 或提示存储不可用 | Database ID 是否正确、云端迁移是否完成、Worker 的 `DB` 是否绑定 `nozoki-db`                                         |
| 登录提示“暂时无法登录”            | `AUTH_ORIGIN` 与地址栏是否一致、两个登录 Secret 是否添加在运行时设置中                                              |
| 绑定自定义域名后无法登录          | `AUTH_ORIGIN` 是否已改为自定义域名并重新部署；改前通过 `workers.dev` 地址之外的自定义域名访问时，任何密码都会被拒绝 |
| 登录提示“邮箱或密码错误”          | 登录邮箱是否与 `ADMIN_EMAIL` 相同，密码是否与 Secret 中设置的值相同                                                 |
| 数据源显示未配置或目标未批准      | 测试是否通过并保存、凭据是否完整；旧接入需按当前公网 HTTPS 流程重新测试                                                         |

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

### 采集与公网来源

单次采集运行：

```sh
pnpm collector:node
```

网页进程和采集进程使用相同的 `NOZOKI_SQLITE_PATH`、集成解密密钥及连接器配置。`COLLECTOR_EPOCH` 为正整数；更改部署中的集成加密密钥或连接器时递增。后台保存的来源凭据变更通过来源修订生效。每次命令按五分钟窗口检查到期来源，D1 版本的租约、修订检查、退避及提交守卫同样用于 SQLite。

需要自动采集时，由运行账号添加系统 Cron，环境文件及路径按实际情况填写：

```cron
*/5 * * * * /usr/bin/node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/collector.mjs
```

采集命令同时执行有界的小时级清理。定时任务由服务器管理员配置。后台批准的公网来源使用进程内受限出站，Tailscale OAuth 使用固定官方端点。网页和采集进程需要使用相同的集成加密密钥。旧来源迁移方法见上文。

### 数据备份与升级

```sh
pnpm db:backup:node /var/backups/nozoki/manual.sqlite
```

备份使用 SQLite online backup，并以 `quick_check` 验证；目标文件必须尚不存在。升级时先备份，停止网页服务与采集任务，替换程序，运行 `db:migrate:node` 后重新启动。迁移使用同一套 `migrations/` SQL，逐文件事务执行并记录 SHA-256。已有数据库存在待执行迁移时，会先写入一致性备份，默认放在数据文件同级的 `backups/`，可通过 `NOZOKI_BACKUP_DIR` 调整。

恢复时先停掉两个进程，将完整备份恢复到新的数据路径，再更新 `NOZOKI_SQLITE_PATH`。正在写入的数据库应通过备份命令复制。数据库、WAL 及共享内存文件位于同机本地磁盘，容器部署需要挂载持久数据卷。当前适合单机运行；SQLite 写入使用 WAL、FULL 同步和一秒锁等待，持续写入拥堵时请求会失败并回滚。

## 项目结构

```text
app/                 Vue 页面、组件、样式与 composable
server/              API、认证、配置服务、Repository、适配器
  collection/        定时采集引擎与编排
shared/
  contracts/         运行时数据校验与共享类型
  schedule/          可独立导入的日程引擎
  device-state/      设备状态与电量解析
  collection/        采集时间与结果规则
  domain/            余额计算及展示数据转换
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

## 后台数据管理

在管理后台的「数据管理」分区统一操作：

- **数据导出**：下载已保存的配置 JSON，包含站点、外观、模块、日程、行情、链接、来源配置及共享背景。未保存的草稿、登录密钥、数据源密钥和采集历史不在文件中。文件包含服务地址与权限设置，请妥善保管。
- **数据导入**：选择导出的 JSON 文件，检查预览后导入草稿，再点击顶栏「保存配置」。新增或改址的来源须先测试，也可选择暂不导入该来源。同地址且身份一致的现有密钥继续使用，其他密钥需重新填写。未包含在备份中的现有来源会停用并保留，不删除其历史。
- **重置全局默认设置**：确认后恢复默认站点、外观、模块、日程、行情及常用链接。自建来源停用，密钥和历史保留；已有且已批准的腾讯来源恢复启用。不会删除数据库、退出登录或重新添加已删除的来源。点击「保存配置」后生效，保存前可放弃修改。

导入不会恢复文件中的目标批准、测试结果或验证能力。涉及新来源或无法安全复用的条目权限时，相关模块先设为仅管理员可见，旧实例的设备、监控或账户条目规则不直接套用；保存后可在模块页检查权限。共享背景随文件迁移，仍受原有图片格式、大小和内容哈希校验约束。文件上限为 2 MiB，保存请求继续使用原有容量限制。

## 开发检查

常规检查：

```sh
pnpm test
pnpm typecheck
pnpm format:check
```

测试源码、辅助脚本与夹具统一使用 `.ts`，通过 Node.js 原生类型擦除运行。运行时代码和构建产物继续使用 `.mjs`。

涉及 D1 或 Worker API 时，先运行 `pnpm build`，再运行 `pnpm test:d1`；测试会复用构建产物。涉及自部署服务时，先运行 `pnpm build:node`，再运行 `pnpm test:node`。两组测试默认都不启动浏览器。构建与部署命令独立执行。

浏览器交互回归按需运行 `pnpm test:browser`，需要先完成 Worker 和 Node 两端构建。测试默认使用 Microsoft Edge，可通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定其他浏览器。布局专项使用 `pnpm test:layout`，需要已启动的本地预览服务。截图保存至忽略版本控制的 `.wrangler/test-results/`。

`pnpm theme:generate` 生成 M3 默认色板，`pnpm dx:generate` 生成早期加载脚本。开发和构建命令会调用相应的准备步骤。

## 许可证

项目代码采用 [MIT 许可证](LICENSE)。第三方许可证见 [public/licenses/](public/licenses/)。

加载动画：[maimai-transition](https://github.com/gfdfdxc/maimai-transition)。
