# 来源安全

Nozoki 采集后台批准的公网 HTTPS 来源。访问批准绑定来源身份、协议、服务根地址、认证方式和协议所需连接参数。替换目标或认证配置后需要重新验证。普通来源测试通过已登记的只读接口执行。

## 公网出站

- 使用可信域名的 HTTPS 443 地址。私网 IP、本地区域和保留地址不能作为普通来源。
- 来源的已登记方法和路径由适配器决定。连接拒绝重定向，浏览器 Cookie 不会带到上游。
- 来源使用自己的凭据。定时额度查询、Tailscale OAuth 等允许的 POST 有固定用途。响应体和执行时间有上限。
- Workers 保留 `global_fetch_strictly_public`，请求经过目标域名的公开入口。Node.js 在连接时验证解析结果、固定公网地址并校验 TLS。
- 使用 Cloudflare Access 等上游防护时，应为所需接口配置受控的机器访问规则。来源连接器不能完成交互式登录。

[Cloudflare 公开 Fetch 兼容标志](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)

## 轮换来源加密密钥

1. 从密码管理器取出当前密钥和仍在使用的历史密钥。
2. 生成新的独立密钥，选择未使用的 `INTEGRATION_KEY_VERSION`。
3. 把旧版本及密钥放入运行时 Secret `INTEGRATION_DECRYPTION_KEYS`。网页和采集进程应同时接收配套设置。
4. 逐个重填需要迁移的来源凭据，测试、批准并保存。确认所有相关密文完成迁移后，再让旧密钥退出运行环境。备份可能仍需旧密钥。

来源凭据加密保存。后台只显示是否已配置，不能找回已保存密钥的明文。数据备份与密钥应分别妥善保管。
