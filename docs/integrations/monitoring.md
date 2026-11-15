# 服务监控

| 来源        | 连接参数                                                    |
| ----------- | ----------------------------------------------------------- |
| UptimeFlare | 实例 HTTPS 根地址，可访问 `GET /api/data`                   |
| Uptime Kuma | 实例 HTTPS 根地址及状态页标识（slug），需公开对应状态页接口 |

在后台添加并验证来源，再启用「服务状态」。两种来源可同时接入。「主页模块 → 服务状态」允许选择首页八个监控、调整顺序并设置别名。名称优先显示后台别名，其次使用上游 `name`，空名称回退至稳定 ID。延迟缺失时会留空，采集不成功也不会凭空将监控判为故障。Kuma 的兼容性以连接测试和实际采集结果为准。

## UptimeFlare 只显示监控 ID

UptimeFlare 自身的状态页从项目配置读取名称。Nozoki 使用 `/api/data` 响应里的监控名称。如果自建实例的 API 没有提供 `name`，可以在 Nozoki 设置别名，或在上游 `pages/api/data.ts` 为 `monitors[monitor.id]` 增加 `name: monitor.name`。保留原监控 ID 并重新部署 UptimeFlare。

确认 `/api/data` 已返回名称，等待 Nozoki 下一次成功采集，再刷新后台监控列表。已选监控由来源和 ID 关联。

[UptimeFlare 配置](https://github.com/lyc8503/UptimeFlare/wiki/Configuration#workerconfig) · [UptimeFlare API 源码](https://github.com/lyc8503/UptimeFlare/blob/main/pages/api/data.ts)
