# 服务监控

| 来源        | 连接参数                                                    |
| ----------- | ----------------------------------------------------------- |
| UptimeFlare | 实例 HTTPS 根地址，可访问 `GET /api/data`                   |
| Uptime Kuma | 实例 HTTPS 根地址及状态页标识（slug），需公开对应状态页接口 |

在后台添加并验证来源，再启用「服务状态」。两种来源可同时接入。「主页模块 → 服务状态」可选择最多八个首页监控、调整顺序并设置别名。名称优先显示后台别名，其次使用上游 `name`，空名称回退至稳定 ID。延迟缺失时显示 `—`。采集失败与监控异常分别显示。Kuma 的兼容性以连接测试和实际采集结果为准。两种来源都可把监控名称变成链接，条件见下文。

## 历史与刷新间隔

首页心跳条汇总近 12 小时的记录。每段覆盖 45 或 60 分钟，以卡片宽度为准。同一时段内出现过异常时，色块保留异常状态。灰色缺测表示该时段没有状态记录。

打开「服务状态」详情后，桌面端双列展示状态时间轴和响应时间曲线。窄屏默认收起，点按行尾箭头可展开一项。悬停可临时查看色块对应的时段或曲线上的单次观测。点按可固定，再点同一位置可取消。

- **Uptime Kuma** 读取公开状态页已有的近期心跳，最多显示 100 条。
- **UptimeFlare** 在现有采集中记录上游发布的快照，详情显示最近 12 小时。两次采集之间的短暂故障可能没有记录，精确事件请查看上游状态页。
- 来源接入可为 UptimeFlare 启用「每 3 分钟采集」。普通来源的最短自动刷新间隔为 300 秒。Node 自部署需配置相应的[定时任务](/deploy/node.md#定时采集)。

## UptimeFlare 监控字段补充

UptimeFlare 的 `/api/data` 默认只返回 `up`、`latency`、`location`、`message`，名称与链接都保存在项目配置中。Nozoki 已为响应预留 `name` 与 `statusPageLink` 两个可选字段，自建实例按需补充输出即可生效，无需改动 Nozoki 配置。

### 获取监控名称

UptimeFlare 自身的状态页从项目配置读取名称。Nozoki 使用 `/api/data` 响应里的监控名称。如果自建实例的 API 没有提供 `name`，可以在 Nozoki 设置别名，或在上游 `pages/api/data.ts` 为 `monitors[monitor.id]` 增加 `name: monitor.name`。保留原监控 ID 并重新部署 UptimeFlare。

### 获取状态页链接

上游每个监控可配置可选的 `statusPageLink`（状态页上监控名称的可点击链接），但默认不会出现在 `/api/data` 响应里。可在 `pages/api/data.ts` 的 `monitors[monitor.id]` 中与 `name` 一起补充：

```ts
monitors[monitor.id] = {
  up: isUp,
  latency: latency.ping,
  location: latency.loc,
  message: isUp ? 'OK' : lastIncident?.error[lastIncident.error.length - 1],
  name: monitor.name,
  statusPageLink: monitor.statusPageLink ?? null,
}
```

重新部署 UptimeFlare 的状态页（Pages/Next 端）即可，Worker 与数据库无需改动。Nozoki 会把该地址用作监控名称的跳转链接：名称为后台别名、上游 `name` 或回退的稳定 ID，主页卡片与详情视图中点击文字即可跳转，文字带下划线且颜色与其它监控名称一致；不再显示独立的「状态页面」链接。字段名必须为 `statusPageLink`，只接受不含用户名密码的 HTTPS 地址，`http://`、空值或其它内容均按未配置处理，不影响该来源的其它监控。未补充该字段的上游名称保持纯文本，行为与原来一致。建议为字段填写真正的状态页地址，避免点击后跳到无关页面。

确认 `/api/data` 已返回名称或链接，等待 Nozoki 下一次成功采集，再刷新后台监控列表。已选监控由来源和 ID 关联。

[UptimeFlare 配置](https://github.com/lyc8503/UptimeFlare/wiki/Configuration#workerconfig) · [UptimeFlare API 源码](https://github.com/lyc8503/UptimeFlare/blob/main/pages/api/data.ts)

## Uptime Kuma 监控链接

Kuma 状态页的监控需在上游开启「显示 URL」（`sendUrl`）；开启后 `GET /api/status-page/{slug}` 的 `publicGroupList[].monitorList[]` 才会带 `url`，取值为 `customUrl ?? url`，即监控目标地址而非常规意义上的状态页地址。Nozoki 直接从这个已有响应读取 `url`，不增加请求、无需新增配置；未开启或字段缺失时名称保持纯文本。

与 UptimeFlare 一样，只接受不含用户名密码的 HTTPS 地址，`http://`、带凭据、空值或其它内容按未配置处理；单个坏值不影响该来源其它监控。链接展示方式同前文：点击监控名称（或回退的稳定 ID）跳转，主页卡片与详情视图均可点，文字带下划线且颜色不变。

注意 `url` 是监控目标，可能是内网地址或带令牌的健康检查地址，公开看板会把该地址显示给所有访问者。建议在上游用 `customUrl` 填一个对外可访问的页面地址，并只对确实希望公开链接的监控开启 `sendUrl`。
