# 管理员认证

使用 [`ADMIN_EMAIL` 与 `ADMIN_PASSWORD`](./environment.md#管理员登录) 登录。登录页位于 `/login`，管理后台位于 `/admin`。缺少有效认证设置时，公开看板仍可供访客浏览。

## 会话和保存

HTTPS 环境使用 Secure、HttpOnly、SameSite=Strict 的 `__Host-nozoki_session` Cookie。默认会话绝对有效期为 12 小时，空闲期限为 30 分钟。注销会撤销保存的服务端会话。更换密码或账户后递增 `AUTH_VERSION`，使旧会话失效。

后台写操作需要有效会话与 CSRF 校验。保存会检查当前配置版本并使用幂等键处理重试。出现版本冲突时，先读取已保存版本，再处理未保存的修改。

## 更改登录邮箱与密码

登录凭据保存在部署环境中（Cloudflare Worker Secret 或 Node 环境文件），不存于数据库，因此通过部署侧变更，没有应用内修改入口。普通用户按部署形态选择其一：

Cloudflare Workers 部署：

1. 生成新密钥或确定新邮箱地址（邮箱仅作账号标识，不发送邮件）。
2. 运行 `pnpm exec wrangler secret put ADMIN_PASSWORD --config wrangler.jsonc`，按交互提示粘贴新密码（12～1024 个字符）。更改邮箱同理设置 `ADMIN_EMAIL`。凭据只通过交互输入或 stdin 传入，不要写入文件或命令行参数。
3. 同时递增 `AUTH_VERSION`（在 `wrangler.jsonc` 的 vars 中加一或改为更大的正整数），使旧会话全部失效，然后推送或部署。
4. 生效后旧会话失效，浏览器会回到登录页，用新凭据登录即可。

Node.js 自部署：

1. 编辑账号环境文件中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `AUTH_VERSION`（递增），文件权限保持 `600`。
2. 重启网页服务与采集任务，再用新凭据登录。

忘记旧密码时，同样方式直接设置新值即可，无需旧密码验证。密码管理器保存的 `AUTH_RATE_LIMIT_SECRET` 与来源加密密钥不受影响。

## 自定义域名与反向代理

将 `AUTH_ORIGIN` 写成浏览器地址栏的站点 origin。Node.js 的反向代理要保留浏览器请求的 `Host`。转发头不作为管理员身份依据。迁移域名后更新配置并重新部署，再用新域名登录。
