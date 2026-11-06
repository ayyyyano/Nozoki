<script setup lang="ts">
import { useDashboardSync } from './composables/useDashboardSync'
const shared = useSharedDashboard()
const { data: dashboard } = await useFetch<
  | import('../shared/contracts/public-dashboard').PublicDashboard
  | import('../shared/contracts/public-dashboard').AdminDashboard
>('/api/dashboard', { key: 'dashboard', onResponseError() {} })
shared.value = dashboard.value?.contractVersion === 1 ? dashboard.value : null
watch(dashboard, (value) => {
  shared.value = value?.contractVersion === 1 ? value : null
})
const {
  appearance,
  effective,
  previewSource,
  dark,
  reduced,
  storageFailed,
  ready,
  toggleTheme,
  resetPersonal,
} = useAppearance()
const settings = useTemplateRef('settings')
const dx = useTemplateRef('dx')
const dxMounted = ref(true)
useHead(() => ({
  htmlAttrs: { 'data-shared-source': shared.value?.site.appearance.sourceColor ?? '#6750A4' },
  title: shared.value?.site.siteName ?? 'Nozoki',
}))
const displayMode = useState<'dashboard' | 'wallpaper'>('nozoki-display-mode', () => 'dashboard')
provide('resetPersonalAppearance', resetPersonal)
let refreshing: Promise<void> | undefined
let refreshAgain = false
const refreshRequest = shallowRef<AbortController | null>(null)
function reloadDashboard(): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      refreshAgain = false
      const prior = shared.value
      refreshRequest.value = new AbortController()
      try {
        const value = await $fetch<typeof dashboard.value>('/api/dashboard', {
          signal: refreshRequest.value.signal,
          timeout: 10000,
        })
        // A logout/clear while the read was in flight must not restore an admin projection.
        if (value?.contractVersion === 1 && shared.value === prior) {
          dashboard.value = value
          await nextTick()
        }
      } catch {
        // A transient read failure retains the last server-filtered projection.
      }
    } while (refreshAgain && !refreshRequest.value?.signal.aborted)
  })().finally(() => {
    refreshing = undefined
  })
  return refreshing
}
provide('reloadDashboard', reloadDashboard)
useDashboardSync(reloadDashboard)
onBeforeUnmount(() => refreshRequest.value?.abort())
provide('openAppearance', () => settings.value?.open())
provide('themeControl', { dark, toggleTheme, ready })
if (import.meta.dev) provide('dxDevelopment', { dx, dxMounted })
</script>
<template>
  <div
    class="nozoki-app"
    :data-color-mode="dark ? 'dark' : 'light'"
    data-preset="m3"
    :data-background-layout="
      effective.background.source === 'off' ? 'off' : effective.background.layout
    "
    :style="{
      '--card-alpha': `${effective.background.cardOpacity}%`,
      '--card-blur': effective.background.cardBlur
        ? `blur(${effective.background.cardBlur}px)`
        : 'none',
    }"
    :data-reduced-motion="reduced"
    :data-theme-ready="ready"
    :data-display-mode="displayMode"
  >
    <a v-show="displayMode === 'dashboard'" class="skip-link" href="#main-content">跳到看板内容</a>
    <LayoutBackgroundScene :config="effective.background" />
    <div class="dashboard-stage"><NuxtPage /></div>
    <LayoutAppearanceDialog
      ref="settings"
      v-model="appearance"
      v-model:preview-source="previewSource"
      :storage-failed="storageFailed"
    />
    <CommonDxTransition v-if="dxMounted" ref="dx" :reduced="reduced" :theme-ready="ready" />
  </div>
</template>
