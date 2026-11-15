# 环境变量

Cloudflare 的密码和密钥放在 Worker 运行时 Secret。构建授权和应用运行时授权分别配置。Node.js 使用账号专有的环境文件。本地 Workers 环境从 `.dev.vars` 读取配置。

## 管理员登录

| 变量                     | 配置                                                                            |
| ------------------------ | ------------------------------------------------------------------------------- |
| `ADMIN_EMAIL`            | 登录邮箱，用作账号标识                                                          |
| `ADMIN_PASSWORD`         | 管理员密码，12～1024 个字符                                                     |
| `AUTH_ORIGIN`            | 完整浏览器 origin，例如 `https://dashboard.example.com`，含非默认端口时一并填写 |
| `AUTH_VERSION`           | 正整数，变更登录凭据时递增以撤销旧会话                                          |
| `AUTH_RATE_LIMIT_SECRET` | 32 字节随机密钥的 base64url 表示，用于会话、CSRF 与限流                         |
| `AUTH_ALLOW_LOCAL_HTTP`  | 只有 loopback HTTP 调试设为 `1`，生产为 `0`                                     |
| `AUTH_TRUST_CF_IP`       | 仅适用于由 Cloudflare 边缘直接接收的请求，普通反代环境留空                      |

可在私有终端生成随机密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

为每项分别生成密钥，用密码管理器保存。Git 和部署日志应使用占位值。

## 来源凭据

| 变量                          | 配置                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `INTEGRATION_ENCRYPTION_KEY`  | 独立的 32 字节 base64url 密钥，保存或验证新的来源凭据时需要 |
| `INTEGRATION_KEY_VERSION`     | 当前密钥版本，如 `v1`                                       |
| `INTEGRATION_DECRYPTION_KEYS` | JSON 对象，键为历史版本，值为对应的 base64url 密钥          |

网页服务、连接验证和采集进程应拥有相同的密钥材料。部署前检查版本和历史密钥，详见[密钥轮换](./security.md#轮换来源加密密钥)。

## Node.js 运行参数

| 变量                 | 配置                                                   |
| -------------------- | ------------------------------------------------------ |
| `HOST`、`PORT`       | 默认监听 `127.0.0.1:3000`                              |
| `NOZOKI_SQLITE_PATH` | 数据库文件的绝对路径                                   |
| `NOZOKI_BACKUP_DIR`  | 可选，迁移前备份目录，默认使用数据库同级的 `backups/`  |
| `COLLECTOR_EPOCH`    | 正整数，首次可设为 `1`，部署级加密或连接环境变化时递增 |

Cloudflare 版本使用 Worker 版本元数据自动管理采集环境。GitHub Actions 需要部署令牌与账户 ID，配置位置见[部署指南](/deploy/github-actions.md)。
