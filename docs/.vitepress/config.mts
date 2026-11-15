import { defineConfig } from 'vitepress'

const base = '/Nozoki/'
const repository = 'https://github.com/ayyyyano/Nozoki'

const sections = [
  {
    text: '指南',
    items: [
      { text: '认识 Nozoki', link: '/guide/overview' },
      { text: '看板模块', link: '/guide/modules' },
      { text: '管理后台', link: '/guide/admin' },
      { text: '站点外观', link: '/guide/appearance' },
      { text: '访客权限', link: '/guide/privacy' },
    ],
  },
  {
    text: '部署',
    items: [
      { text: '选择部署方式', link: '/deploy/' },
      { text: 'Cloudflare 初始化', link: '/deploy/cloudflare' },
      { text: 'Workers Builds', link: '/deploy/cloudflare-builds' },
      { text: 'GitHub Actions', link: '/deploy/github-actions' },
      { text: 'Node.js 自部署', link: '/deploy/node' },
      { text: '本地运行', link: '/deploy/local' },
      { text: 'Agent 快速部署', link: '/deploy/agent' },
    ],
  },
  {
    text: '数据源',
    items: [
      { text: '接入流程', link: '/integrations/' },
      { text: 'DeepSeek', link: '/integrations/deepseek' },
      { text: 'Sleepy', link: '/integrations/sleepy' },
      { text: 'Tailscale', link: '/integrations/tailscale' },
      { text: 'CLIProxyAPI', link: '/integrations/cliproxyapi' },
      { text: '行情', link: '/integrations/quotes' },
      { text: '监控', link: '/integrations/monitoring' },
    ],
  },
  {
    text: '进阶',
    items: [
      { text: '环境变量', link: '/operations/environment' },
      { text: '管理员认证', link: '/operations/authentication' },
      { text: '来源安全', link: '/operations/security' },
      { text: '备份与恢复', link: '/operations/backup' },
      { text: '升级与迁移', link: '/operations/migrations' },
      { text: '故障排查', link: '/operations/troubleshooting' },
    ],
  },
]

export default defineConfig({
  lang: 'zh-CN',
  title: 'Nozoki',
  description: 'Nozoki 个人看板的使用、部署与维护指南。',
  base,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: base + 'favicon.svg' }]],
  themeConfig: {
    siteTitle: false,
    logo: { src: '/logo.png', alt: 'Nozoki' },
    nav: sections.map(({ text, items }) => ({ text, link: items[0].link })),
    sidebar: sections,
    socialLinks: [{ icon: 'github', link: repository }],
    outline: { label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '文档菜单',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换至浅色模式',
    darkModeSwitchTitle: '切换至深色模式',
    skipToContentLabel: '跳到正文',
    notFound: {
      title: '页面未找到',
      quote: '请从首页导航或搜索查找文档。',
      linkLabel: '返回首页',
      linkText: '返回首页',
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细结果',
            resetButtonTitle: '清空搜索',
            backButtonTitle: '关闭搜索',
            noResultsText: '未找到相关内容',
            footer: { selectText: '打开', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
  },
})
