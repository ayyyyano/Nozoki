# CLIProxyAPI 与 Codex

在「来源接入」添加 CLIProxyAPI，填写支持 v8 Management API 的实例根地址，例如 `https://proxy.example.com/`。凭据使用 **Management Key**，可在 CLIProxyAPI 的管理配置中设置。客户端发送模型请求使用的 API Key 与这个管理凭据用途不同。

## 管理接口

| 方法与路径                                              | 用途                |
| ------------------------------------------------------- | ------------------- |
| `GET /v8/management/credentials`                        | 查验连接、读取账户  |
| `POST /v8/management/requests/api-call`                 | 定向获取 Codex 额度 |
| `GET /v8/management/observability/usage/queue?count=50` | 有界读取用量事件    |

在代理层限制管理接口的访问。额度查询的允许目标应限定为 `GET https://chatgpt.com/backend-api/wham/usage`。管理 API 本身能够发起上游请求，Management Key 应视为高权限凭据。[CLIProxyAPI v8 管理接口](https://github.com/router-for-me/CLIProxyAPI/blob/main/docs/management-api-v8.md)

## 额度圆环

Nozoki 在来源到期时，通过 CLIProxyAPI 定向查询一个可用 Codex 账户的 5 小时和周额度。查询成功后，直接使用 Codex 产生的额度变化也能反映到看板。更新频率取决于刷新间隔、调度及上游是否可用。

首页允许选择两个圆环，详情展示允许查看的指标。重置进度需要有效的窗口时间。满额空闲时可能有额度百分比但缺少下次重置时间。上游缺少部分窗口时延续各自最后的有效观测和观测时间，过期提示仍会显示。

## 按日用量

按需在 CLIProxyAPI 的 `config.yaml` 启用队列统计，并重启该实例：

```yaml
observability:
  usage:
    usage-statistics-enabled: true
    redis-usage-queue-retention-seconds: 3600
```

把队列保留秒数设得比实际采集间隔长。上游默认 60 秒，上限 3600 秒。启用后需要有通过 CLIProxyAPI 的 Codex 请求，队列才有事件。额度查询和本地的逐请求统计是两种数据。[CLIProxyAPI 队列说明](https://github.com/router-for-me/CLIProxyAPIDocs/blob/main/docs/en/management/apiv8.md#usage)

**读取即消费。请让 Nozoki 独占该队列。** Nozoki 在正式采集中每轮最多读 50 条。连接测试只读账户接口。本站只累加能归属现有 Codex 账户的记录，按事件的 UTC 日期累计输入、输出、推理、缓存、总 Token、请求和失败数，保留最近 400 个 UTC 日。队列为空时保留已有累计。

上游重启、超出保留时间或其他消费者抢读都会丢失尚未消费的记录。若 Nozoki 已取出一批记录但保存失败，该批无法重放。统计反映实际成功入库的记录，费用和官方账户账单需要到对应提供方查看。
