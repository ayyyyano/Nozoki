<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import type { AdminDashboard } from '../../../shared/contracts/public-dashboard'
import { dashboardView } from '../../../shared/domain/dashboard-view'
import { HOME_LIMITS } from '../../../shared/domain/home-summary'
const model = defineModel<ModuleSettings>({ required: true })
const { data, status, error, refresh } = await useFetch<AdminDashboard>('/api/dashboard', {
  key: 'admin-service-home',
  server: false,
})
const choices = computed(() => {
  const refs = Object.values(model.value.sources).map((s) => s.sourceId)
  return (data.value ? (dashboardView(data.value).services.data?.monitors ?? []) : []).flatMap(
    (m) => {
      const sourceId = refs.find((id) => m.id.startsWith(id + '/'))
      return sourceId ? [{ sourceId, monitorId: m.id, name: m.name }] : []
    },
  )
})
const selected = computed(() => model.value.homeServices)
function toggle(item: { sourceId: string; monitorId: string }, checked: boolean) {
  const values = [
    ...(selected.value ??
      choices.value
        .slice(0, HOME_LIMITS.services)
        .map(({ sourceId, monitorId }) => ({ sourceId, monitorId }))),
  ]
  const index = values.findIndex(
    (v) => v.sourceId === item.sourceId && v.monitorId === item.monitorId,
  )
  if (checked && index < 0 && values.length < HOME_LIMITS.services)
    values.push({ sourceId: item.sourceId, monitorId: item.monitorId })
  if (!checked && index >= 0) values.splice(index, 1)
  model.value.homeServices = values
}
function onToggle(item: { sourceId: string; monitorId: string }, event: Event) {
  toggle(item, (event.target as HTMLInputElement).checked)
}
function checked(id: string) {
  return (selected.value ?? choices.value.slice(0, HOME_LIMITS.services)).some(
    (v) => v.monitorId === id,
  )
}
const missing = computed(
  () =>
    selected.value?.filter(
      (v) => !choices.value.some((c) => c.monitorId === v.monitorId && c.sourceId === v.sourceId),
    ) ?? [],
)
</script>
<template>
  <section class="service-home-editor">
    <h3>首页展示</h3>
    <p class="admin-note">
      最多 8 项，按勾选顺序展示；未选中的服务仍保留在详情。{{
        selected === undefined ? '当前按来源顺序自动选择。' : `已明确选择 ${selected.length} 项。`
      }}
    </p>
    <p v-if="status === 'pending'" role="status">正在读取已采集监控…</p>
    <p v-else-if="error" role="alert">无法读取监控列表，可重试；已保存的选择保持不变。</p>
    <p v-else-if="!choices.length" class="admin-note">尚无可用监控，请保存来源配置并等待采集。</p>
    <label v-for="item in choices" :key="item.monitorId" class="service-home-choice">
      <input
        type="checkbox"
        :checked="checked(item.monitorId)"
        :disabled="
          !checked(item.monitorId) && (selected?.length ?? Math.min(choices.length, 8)) >= 8
        "
        @change="onToggle(item, $event)"
      />
      <CommonAppIcon
        :name="checked(item.monitorId) ? 'CheckBoxRound' : 'CheckBoxOutlineBlankRound'"
      /><span>{{ item.name }}</span>
    </label>
    <p v-for="item in missing" :key="item.monitorId" class="admin-note">
      暂不可用：{{ item.monitorId }}
      <VarButton text @click="model.homeServices = selected?.filter((v) => v !== item)"
        >移除选择</VarButton
      >
    </p>
    <div class="admin-actions">
      <VarButton tonal @click="refresh()">刷新监控列表</VarButton
      ><VarButton text @click="delete model.homeServices">恢复自动选择</VarButton>
    </div>
  </section>
</template>
