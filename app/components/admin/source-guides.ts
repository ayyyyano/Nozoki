export const sourceGuides = {
  tailscale: {
    title: 'Tailscale 配置说明',
    steps: [
      '在 Tailscale 管理控制台打开 Trust credentials，选择 Credential → OAuth。',
      '只授予设备核心信息读取权限（devices:core:read），生成 OAuth 客户端。',
      '复制 Client ID 和 Client Secret，分别填入 Nozoki 的对应输入框。Client Secret 仅在生成时显示，请立即保存。',
    ],
    href: 'https://tailscale.com/docs/features/oauth-clients',
    link: 'Tailscale OAuth 文档',
  },
  cliproxy: {
    title: 'CLIProxyAPI 配置说明',
    steps: [
      '填写 CLIProxyAPI 实例的 HTTPS 根地址，例如 https://proxy.example.com/。如果实例部署在子路径下，请保留该路径；无需附加 /v1 或管理接口路径。',
      '在 Management Key 输入框填写实例配置中 management.secret-key 对应的原始密钥，例如 YOUR_MANAGEMENT_KEY。普通推理 API Key 无法访问管理接口。',
      '确认实例允许 Nozoki 远程访问管理接口。直接使用 CLIProxyAPI 的远程管理时需要开启 management.allow-remote，并通过 HTTPS 访问。',
    ],
    href: 'https://help.router-for.me/management/apiv8',
    link: 'CLIProxyAPI v8 管理接口文档',
  },
  deepseek: {
    title: 'DeepSeek 配置说明',
    steps: [
      '登录 DeepSeek 开放平台，在 API Keys 页面创建密钥并复制。',
      '将密钥填入 Nozoki 的 API Key 输入框。服务地址已预设为 https://api.deepseek.com/。',
    ],
    href: 'https://platform.deepseek.com/api_keys',
    link: '打开 DeepSeek API Keys',
  },
} satisfies Record<string, { title: string; steps: string[]; href: string; link: string }>

export type SourceGuide = (typeof sourceGuides)[keyof typeof sourceGuides]
