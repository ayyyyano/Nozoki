<script setup lang="ts">
import { dashboardView } from '../../shared/domain/dashboard-view'
import { moduleRole } from '../../shared/domain/module-layout'
import { isSafeLink } from '../../shared/domain/dashboard'
import {
  createUnconfiguredDashboard,
  defaultModules,
  layoutModules,
} from '../../shared/domain/dashboard'
const shared = useSharedDashboard()
const moduleIcons: Record<import('../../shared/contracts/dashboard').ModuleId, string> = {
  deepseek: 'spark',
  devices: 'devices',
  tailscale: 'network',
  codex: 'code',
  activity: 'clock',
  quotes: 'chart',
  links: 'link',
  services: 'server',
}
const data = ref(shared.value ? dashboardView(shared.value) : createUnconfiguredDashboard())
const liveData = shallowRef(data.value)
const modules = ref<import('../../shared/contracts/dashboard').ModuleConfig[]>(
  shared.value
    ? shared.value.modules.map((m) => ({
        ...m,
        enabled: true,
        visibility: 'public' as const,
        guestBehavior: 'hidden' as const,
        fields: {},
      }))
    : import.meta.dev
      ? defaultModules()
      : [],
)
const hints = computed(() =>
  import.meta.dev && data.value !== liveData.value
    ? new Set<string>()
    : new Set(
        shared.value?.modules.filter((m) => m.kind === 'login_required').map((m) => m.id) ?? [],
      ),
)
watch(shared, (value) => {
  data.value = value ? dashboardView(value) : createUnconfiguredDashboard()
  liveData.value = data.value
  modules.value = value
    ? value.modules.map((m) => ({
        ...m,
        enabled: true,
        visibility: 'public',
        guestBehavior: 'hidden',
        fields: {},
      }))
    : []
})
const visible = computed(() => layoutModules(modules.value))
useHead(() => ({ title: shared.value?.site.siteName ?? 'Nozoki' }))

const account = useTemplateRef('account')
const accountLabel = computed(() => (shared.value?.viewer === 'admin' ? '管理后台' : '账户登录'))
function openAccount() {
  if (shared.value?.viewer === 'admin') return navigateTo('/admin', { external: true })
  account.value?.open()
}
const displayMode = useState<'dashboard' | 'wallpaper'>('nozoki-display-mode', () => 'dashboard')
function toggleDisplay() {
  displayMode.value = displayMode.value === 'dashboard' ? 'wallpaper' : 'dashboard'
}
const now = useLocalClock()
const openAppearance = inject<() => void>('openAppearance')
const themeControl = inject<{ dark: Ref<boolean>; ready: Ref<boolean>; toggleTheme: () => void }>(
  'themeControl',
)!
const DevPreview = import.meta.dev
  ? defineAsyncComponent(() => import('../components/dev/FixturePreview.vue'))
  : null
</script>
<template>
  <div class="page-actions">
    <VarButton
      round
      text
      :aria-label="displayMode === 'dashboard' ? '显示纯壁纸' : '恢复看板'"
      :title="displayMode === 'dashboard' ? '显示纯壁纸' : '恢复看板'"
      :aria-pressed="displayMode === 'wallpaper'"
      @click="toggleDisplay"
    >
      <CommonAppIcon
        :name="displayMode === 'dashboard' ? 'eye' : 'eyeOff'"
        :filled="displayMode === 'wallpaper'"
      />
    </VarButton>
    <VarButton
      v-show="displayMode === 'dashboard'"
      round
      text
      :aria-label="
        themeControl.ready.value
          ? themeControl.dark.value
            ? '切换到亮色模式'
            : '切换到暗色模式'
          : '切换明暗模式'
      "
      :title="themeControl.dark.value ? '切换到亮色模式' : '切换到暗色模式'"
      @click="themeControl.toggleTheme"
    >
      <span class="theme-icon-light"><CommonAppIcon name="moon" /></span
      ><span class="theme-icon-dark"><CommonAppIcon name="sun" /></span>
    </VarButton>
    <VarButton
      v-show="displayMode === 'dashboard'"
      round
      text
      aria-label="外观偏好"
      title="外观偏好"
      @click="openAppearance?.()"
      ><CommonAppIcon name="tune"
    /></VarButton>
    <VarButton
      v-show="displayMode === 'dashboard'"
      round
      text
      :aria-label="accountLabel"
      :title="accountLabel"
      :aria-haspopup="shared?.viewer === 'admin' ? undefined : 'dialog'"
      @click="openAccount"
      ><CommonAppIcon name="person" :filled="shared?.viewer === 'admin'"
    /></VarButton>
  </div>
  <main
    v-show="displayMode === 'dashboard'"
    :inert="displayMode === 'wallpaper'"
    id="main-content"
    class="dashboard-container"
    tabindex="-1"
  >
    <h1 class="sr-only">{{ shared?.site.siteName ?? 'Nozoki' }} 摸鱼看板</h1>
    <p v-if="!shared && !DevPreview" role="alert">共享配置暂时不可用，请稍后刷新。</p>
    <component :is="DevPreview" v-if="DevPreview" v-model:data="data" v-model:modules="modules" />
    <LayoutDashboardGrid
      :business-count="visible.filter((m) => moduleRole(m.id) === 'business').length"
      :links-visible="
        visible.some((m) => moduleRole(m.id) === 'navigation') &&
        !hints.has('links') &&
        !!data.links.data?.items.some((item) => isSafeLink(item.url))
      "
    >
      <template v-for="module in visible" :key="module.id">
        <DashboardModuleCard
          v-if="hints.has(module.id)"
          :id="module.id"
          :title="module.title"
          :icon="moduleIcons[module.id]"
          status="unconfigured"
          ><a href="/login" @click.prevent="account?.open()">登录后查看</a></DashboardModuleCard
        >
        <DashboardDeepSeekCard
          v-else-if="module.id === 'deepseek'"
          :title="module.title"
          :snapshot="data.deepseek"
        />
        <DashboardDevicesCard
          v-else-if="module.id === 'devices'"
          :title="module.title"
          :snapshot="data.devices"
        />
        <DashboardTailscaleCard
          v-else-if="module.id === 'tailscale'"
          :title="module.title"
          :snapshot="data.tailscale"
        />
        <DashboardCodexCard
          v-else-if="module.id === 'codex'"
          :title="module.title"
          :snapshot="data.codex"
        />
        <DashboardActivityCard
          v-else-if="module.id === 'activity'"
          :title="module.title"
          :snapshot="data.activity"
          :now="now"
        />
        <DashboardQuotesCard
          v-else-if="module.id === 'quotes'"
          :title="module.title"
          :snapshot="data.quotes"
        />
        <DashboardLinksCard
          v-else-if="module.id === 'links'"
          :title="module.title"
          :snapshot="data.links"
        />
        <DashboardServicesCard v-else :title="module.title" :snapshot="data.services" />
      </template>
    </LayoutDashboardGrid>
  </main>
  <AuthAccountDialog ref="account" />
</template>
<style scoped>
.dashboard-container :deep(a) {
  text-decoration: none;
}
</style>
