<script setup lang="ts">
import type { DataSnapshot, ServicesData } from '../../../shared/contracts/dashboard'
import type { HomeMonitorHistory } from '../../../shared/contracts/service-history'
import { HISTORY_HOURS } from '../../../shared/contracts/service-history'
import { MONITOR_HISTORY_LABELS } from '../../../shared/domain/chart-series'
import { monitorName, monitorStale, serviceSummary } from '../../../shared/domain/home-summary'
const props = defineProps<{ snapshot: DataSnapshot<ServicesData>; title: string }>()
const now = useLocalClock()
const summary = computed(() => serviceSummary(props.snapshot, now.value))
const dashboard = useSharedDashboard()
const projection = computed(() => `${dashboard.value?.viewer}/${dashboard.value?.configVersion}`)
const revision = computed(() =>
  JSON.stringify([
    props.snapshot.collectedAt,
    props.snapshot.partialFailures,
    props.snapshot.data?.monitors.map(({ id, checkedAt }) => [id, checkedAt]),
  ]),
)
const homeScope = computed(() =>
  JSON.stringify([projection.value, summary.value.items.map(({ id }) => id)]),
)
const homeWindow = computed(() => Math.floor(now.value / (15 * 60_000)))
const homeHistory = shallowRef(new Map<string, HomeMonitorHistory['segments']>())
const revealHistory = ref(false)
let historyRevealed = false
onMounted(() => {
  watch(
    [homeScope, revision, homeWindow],
    async ([scope], previous, onCleanup) => {
      if (scope !== previous?.[0]) {
        homeHistory.value = new Map()
        revealHistory.value = false
      }
      if (!summary.value.items.length) return
      const request = new AbortController()
      onCleanup(() => request.abort())
      try {
        const histories = await $fetch<HomeMonitorHistory[]>('/api/service-history', {
          query: { view: 'home' },
          signal: request.signal,
          retry: 0,
          timeout: 10000,
        })
        if (!request.signal.aborted) {
          revealHistory.value = !historyRevealed && histories.length > 0
          historyRevealed ||= revealHistory.value
          homeHistory.value = new Map(histories.map(({ id, segments }) => [id, segments]))
        }
      } catch {
        if (!request.signal.aborted) {
          revealHistory.value = false
          homeHistory.value = new Map()
        }
      }
    },
    { immediate: true },
  )
})
const expired = computed(() =>
  (props.snapshot.data?.monitors ?? [])
    .filter((monitor) => monitorStale(monitor, props.snapshot, now.value))
    .map((monitor) => monitorName(monitor.name, monitor.displayId ?? monitor.id)),
)
</script>
<template>
  <DashboardModuleCard
    id="services"
    :title="title"
    :status="snapshot.status"
    :has-data="!!summary.total"
    :observed-at="snapshot.collectedAt"
    :last-success-at="snapshot.lastSuccessAt"
    time-label="采集于"
    :details="summary.total > 0"
    refreshable
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="!!summary.total"
      :empty="!summary.total"
      compact
    />
    <DashboardMonitorList
      :monitors="summary.items"
      :snapshot="snapshot"
      :history="homeHistory"
      :class="{ 'home-history-ready': revealHistory }"
    />
    <p v-if="summary.total && !summary.items.length" class="quiet-note">
      未选择首页服务，可在详情中查看。
    </p>
    <template v-if="summary.down || summary.unknown" #footer>
      <span role="status" aria-label="全部监控状态">
        <span v-if="summary.down">异常 {{ summary.down }}</span
        ><span v-if="summary.down && summary.unknown"> · </span
        ><span v-if="summary.unknown">待确认 {{ summary.unknown }}</span>
      </span>
    </template>
    <template v-if="snapshot.status !== 'stale' && expired.length" #freshness>
      <p role="status">数据已过期 · {{ expired.join('、') }}</p>
    </template>
    <template #details="{ open }">
      <DashboardDataState :status="snapshot.status" :empty="!summary.total" compact />
      <p v-if="summary.total" class="quiet-note">
        {{ summary.total }} 项监控 · 近 {{ HISTORY_HOURS }} 小时
      </p>
      <p v-if="snapshot.partialFailures" class="scope-note" role="status">
        {{ snapshot.partialFailures }} 个来源暂不可用，采集失败不代表服务离线。
      </p>
      <ul v-if="summary.total" class="chart-state-legend" aria-label="状态图例">
        <li v-for="(label, state) in MONITOR_HISTORY_LABELS" :key="state">
          <i class="monitor-history-segment" :data-state="state" aria-hidden="true" />{{ label }}
        </li>
      </ul>
      <DashboardMonitorList
        v-if="open"
        :key="projection"
        :monitors="snapshot.data?.monitors ?? []"
        :snapshot="snapshot"
        :revision="revision"
        detail
      />
    </template>
  </DashboardModuleCard>
</template>
