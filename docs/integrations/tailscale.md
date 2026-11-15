# Tailscale

1. 在 Tailscale 管理界面的 **Settings → Trust credentials** 新建 OAuth Client，只授予设备核心数据读取权限 `devices:core:read`。
2. 在「来源接入」添加 Tailscale，填写 OAuth Client ID 和 Client Secret，测试并保存。
3. 在「主页模块 → Tailscale」启用模块，并配置首页节点及访客的名称和 IP 可见性。

[创建 OAuth Client](https://tailscale.com/kb/1215/oauth-clients) · [设备 API](https://tailscale.com/api#tag/devices)

Nozoki 使用 Tailscale 官方接口换取只读令牌，再获取设备列表。部署主机无需加入 Tailnet。节点状态来自 `connectedToControl`，表示设备是否连接 Tailscale 控制面。它不能验证设备上运行的具体服务。

访客可见性由服务端应用。遮蔽输出使用固定占位，隐藏模式移除受限值。需要查看前台应用或电量时另行接入 [Sleepy](./sleepy.md)。
