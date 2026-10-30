const projectRoot = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:)/,
  '$1',
)
// Config-only environment access; avoid adding Node ambient types to the app.
const buildDirectory = (globalThis as { process?: { env?: { NOZOKI_BUILD_DIR?: string } } }).process
  ?.env?.NOZOKI_BUILD_DIR
const nodeDeployment =
  (globalThis as { process?: { env?: { NOZOKI_TARGET?: string } } }).process?.env?.NOZOKI_TARGET ===
  'node'
export default defineNuxtConfig({
  compatibilityDate: '2026-10-19',
  telemetry: false,
  devtools: { enabled: false },
  ssr: true,
  buildDir: buildDirectory || '.nuxt',
  // Keep production builds away from the running developer server and its lock.
  $production: {
    buildDir: nodeDeployment
      ? 'node_modules/.cache/nuxt/node-production'
      : 'node_modules/.cache/nuxt/production',
    ...(nodeDeployment ? {} : { nitro: { entry: projectRoot + 'server/worker-entry.ts' } }),
  },
  $development: {
    nitro: {
      cloudflare: {
        dev: {
          configPath: (globalThis as { process?: { env?: Record<string, string> } }).process?.env
            ?.NOZOKI_LOCAL_AUTH_CONFIG,
          persistDir: (globalThis as { process?: { env?: Record<string, string> } }).process?.env
            ?.NOZOKI_LOCAL_AUTH_CONFIG
            ? projectRoot + '.wrangler/local-debug/state/v3'
            : projectRoot + '.wrangler/state/v3',
        },
      },
    },
  },
  app: {
    head: {
      title: 'Nozoki · 摸鱼看板',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [{ name: 'description', content: '日程、设备与服务，一处查看。' }],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'stylesheet', href: '/dx-init.css' },
      ],
      script: [
        { src: '/theme-init.js', tagPosition: 'head', defer: false },
        { src: '/dx-init.js', tagPosition: 'head', async: true },
      ],
    },
  },
  nitro: nodeDeployment
    ? {
        preset: 'node',
        serveStatic: true,
        esbuild: { options: { target: 'es2023' } },
        output: { dir: projectRoot + '.output-node' },
      }
    : {
        alias: {
          '#nozoki-cloudflare-entry':
            projectRoot +
            'node_modules/.pnpm/node_modules/nitropack/dist/presets/cloudflare/runtime/cloudflare-module.mjs',
        },
        preset: 'cloudflare_module',
        cloudflare: { deployConfig: false, nodeCompat: true },
      },
  typescript: { strict: true },
  build: { transpile: ['@varlet/ui', '@vicons/material', 'dayjs'] },
  css: ['~/assets/styles/m3-themes.css', '~/assets/styles/dashboard.css'],
  components: [{ path: '~/components', ignore: ['**/dev/**'] }],
  vite: {
    optimizeDeps: { include: ['@material/material-color-utilities', '@varlet/ui'] },
    build: {
      rolldownOptions: {
        // Nitro bundles shared sources; keep their absolute paths until that step on Windows.
        makeAbsoluteExternalsRelative: false,
      },
    },
  },
})
