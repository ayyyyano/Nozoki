# Node.js 自部署

需要 Node.js 24.21.0、pnpm 12.15.0 和可持久写入的本地磁盘。SQLite 使用 Node 自带的 `node:sqlite`。本指南的路径与服务管理示例适用于 Linux。

## 构建与启动

```sh
pnpm install --frozen-lockfile
pnpm build:node
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，设置 [认证环境变量](/operations/environment.md) 和数据库文件的绝对路径，如 `/var/lib/nozoki/nozoki.sqlite`。先创建数据目录，将写权限交给运行服务的账号。已有 `.env` 时直接更新文件。

```sh
pnpm db:migrate:node
pnpm start:node
```

服务默认监听 `127.0.0.1:3000`。也可将完整的 `.output-node/` 复制到服务器，直接使用 Node：

```sh
node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/database.mjs migrate
node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/start.mjs
```

## HTTPS 和进程管理

在同一主机通过 Caddy 或 Nginx 转发 HTTPS，保留浏览器请求的 `Host`。按公开访问地址设置 `AUTH_ORIGIN`，生产环境使用 `AUTH_ALLOW_LOCAL_HTTP=0`。

```text
dashboard.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

可创建 `/etc/systemd/system/nozoki.service`。先创建运行账号 `nozoki`，核对实际路径和文件权限。

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

用公开 HTTPS 地址打开 `/login`，保存一项设置，再刷新检查。

## 定时采集

运行 `pnpm collector:node` 可执行一轮到期采集。自动采集可在同一运行账号下配置系统 Cron：

```text
*/5 * * * * /usr/bin/node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/collector.mjs
```

网页服务和采集使用同一数据库、加密配置及采集环境变量。后台批准的公网 HTTPS 数据源由进程直接连接。SQLite 部署面向单机运行，数据库及 WAL、共享内存文件应在同一块本地持久磁盘上。升级或切换主机前请参阅[备份与恢复](/operations/backup.md)。
