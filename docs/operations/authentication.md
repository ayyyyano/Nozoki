# 管理员认证

使用 [`ADMIN_EMAIL` 与 `ADMIN_PASSWORD`](./environment.md#管理员登录) 登录。登录页位于 `/login`，管理后台位于 `/admin`。缺少有效认证设置时，公开看板仍可供访客浏览。

## 会话和保存

HTTPS 环境使用 Secure、HttpOnly、SameSite=Strict 的 `__Host-nozoki_session` Cookie。默认会话绝对有效期为 12 小时，空闲期限为 30 分钟。注销会撤销保存的服务端会话。更换密码或账户后递增 `AUTH_VERSION`，使旧会话失效。

后台写操作需要有效会话与 CSRF 校验。保存会检查当前配置版本并使用幂等键处理重试。出现版本冲突时，先读取已保存版本，再处理未保存的修改。

## 自定义域名与反向代理

将 `AUTH_ORIGIN` 写成浏览器地址栏的站点 origin。Node.js 的反向代理要保留浏览器请求的 `Host`。转发头不作为管理员身份依据。迁移域名后更新配置并重新部署，再用新域名登录。
