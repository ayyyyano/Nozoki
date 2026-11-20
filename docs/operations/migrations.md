# 升级与迁移

升级前记录当前版本并[备份数据库与密钥](./backup.md)。确认目标环境和绑定后再运行迁移。迁移器会检查已经应用的文件，待执行的迁移随版本向前应用。

## Cloudflare Workers

使用以下命令构建和发布。选择 Git 自动部署时，工作流或 Workers Builds 使用相同发布命令。

```sh
pnpm build
pnpm deploy:cloudflare
```

部署脚本会先应用 D1 迁移，迁移失败就停止发布。需要独立执行时使用 `pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc`。兼容的七模块旧结构升级期间可以只读展示，迁移完成后刷新。空库、损坏结构或配置缺失需要先修复数据库。

Git 自动部署使用同一发布命令。GitHub Actions 默认不创建 D1、不设置运行时 Secret、不绑定自定义域名，也不删除任何资源；显式开启[数据库自举](/deploy/github-actions.md#首次部署数据库自举)后，才按 `database_name` 查库并在缺失时创建，且只在 runner 上生成临时配置副本。自举应用的是建表迁移，新库为空，不导入历史数据。删除 Worker/D1、迁移历史数据与重设密钥始终由站点所有者本人完成。

从旧双 Worker 安装升级时，站点由主 Worker 采集。确认新的 Cron 生效后，由站点所有者清理旧 Collector 的触发器和构建连接。回滚应用时重新构建并发布目标版本，先确认数据库迁移与旧代码兼容。

## Node.js

先停网页服务和采集任务，更新源码与构建产物，再迁移和启动。数据库与环境文件放在发布目录之外。

```sh
pnpm install --frozen-lockfile
pnpm build:node
pnpm db:migrate:node
pnpm start:node
```

SQLite 迁移逐文件执行事务并记录校验和。有待执行迁移的既有数据库会生成迁移前备份。新建 SQLite 实例时，D1 的历史数据需单独导出并转换。共享配置可使用后台 JSON 导入。

## 旧来源

`0019_public_sources.sql` 将符合已知协议、官方根地址和来源类型的旧固定来源转为批准记录，并保留 ID、凭据与历史。其他来源需要在「来源接入」核对公网地址、补齐凭据、重新测试并保存。页面标记为不支持编辑的旧协议应按现有来源类型重新接入。已经保存的站点配置升级后先刷新后台，避免提交旧版本草稿。

旧 CLIProxyAPI Relay 账户已有按 ID 设置的权限时，可在来源编辑页用「迁移已有账户权限」提交原账户身份密钥。匹配后系统会加密保存，失败需核对原密钥、账户和上游连通性。配置中由后台批准的公网来源使用原生出站，旧部署路由变量不参与来源批准。
