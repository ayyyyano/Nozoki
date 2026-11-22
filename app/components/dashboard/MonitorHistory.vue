<script setup lang="ts">
import type { MonitorHistory } from '../../../shared/contracts/service-history'
import {
  MONITOR_HISTORY_LABELS,
  historyBucketIndex,
  historyWindowStart,
  latencySeries,
  statusBuckets,
} from '../../../shared/domain/chart-series'

const props = defineProps<{ monitorId: string; revision: string }>()
const timezone = useDashboardTimezone()
const root = useTemplateRef<HTMLElement>('root')
const escapeHandlers = inject<Set<() => boolean>>('dashboard-detail-escape')
const history = shallowRef<MonitorHistory>()
const failed = ref(false)
const loading = ref(true)
const until = ref(0)
const width = ref(360)
let resize: ResizeObserver | undefined
let visibility: IntersectionObserver | undefined
let request: AbortController | undefined
let started = false

async function load() {
  request?.abort()
  const current = new AbortController()
  request = current
  failed.value = false
  try {
    const next = await $fetch<MonitorHistory>('/api/service-history', {
      query: { monitor: props.monitorId },
      signal: current.signal,
      retry: 0,
      timeout: 10000,
    })
    if (current.signal.aborted) return
    const end = Date.parse(next.until ?? '')
    until.value = Number.isFinite(end) ? end : Date.now()
    history.value = next
  } catch (error) {
    if (current.signal.aborted) return
    history.value = undefined
    failed.value = (error as { statusCode?: number }).statusCode !== 404
  } finally {
    if (!current.signal.aborted) loading.value = false
  }
}
watch(
  () => props.revision,
  () => {
    if (started) void load()
  },
)
onMounted(() => {
  escapeHandlers?.add(clearSelection)
  const element = root.value
  if (!element) return
  resize = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  resize.observe(element)
  visibility = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return
      visibility?.disconnect()
      started = true
      void load()
    },
    { root: element.closest('.module-detail-content'), rootMargin: '96px 0px' },
  )
  visibility.observe(element)
})
onBeforeUnmount(() => {
  escapeHandlers?.delete(clearSelection)
  request?.abort()
  resize?.disconnect()
  visibility?.disconnect()
})

const formatter = computed(
  () =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone.value,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }),
)
const stamps = (at: number) => formatter.value.format(at)
const scaleTime = (at: number) => stamps(at).slice(11, 16)
const windowRange = computed(() => [historyWindowStart(until.value), until.value] as const)
const past = computed(() =>
  (history.value?.points ?? []).filter(({ at }) => {
    const time = Date.parse(at)
    return time >= windowRange.value[0] && time <= windowRange.value[1]
  }),
)
const buckets = computed(() =>
  history.value?.showStatus
    ? statusBuckets(
        past.value,
        Math.max(12, Math.min(100, Math.floor(width.value / 9))),
        until.value,
      )
    : [],
)
const observations = computed(
  () => new Map(past.value.map((point) => [Date.parse(point.at), point] as const)),
)
const latency = computed(() => {
  const interval = history.value?.intervalSeconds
  return latencySeries(past.value, interval == null ? undefined : interval * 1500)
})

type Selection = { kind: 'bucket' | 'point'; at: number }
const preview = ref<Selection | null>(null)
const pinned = ref<Selection | null>(null)
const active = computed(() => preview.value ?? pinned.value)
const bucketAt = (at: number) => historyBucketIndex(buckets.value, at)
const statusIndex = computed(() => {
  const index = active.value ? bucketAt(active.value.at) : -1
  return index < 0 ? null : index
})
const latencyIndex = computed(() => {
  if (active.value?.kind !== 'point') return null
  const index = latency.value.findIndex((point) => point.at === active.value?.at)
  return index < 0 ? null : index
})
const activeBucket = computed(() => buckets.value[statusIndex.value ?? -1])
const highlightRange = computed(() => {
  const bucket = activeBucket.value
  return active.value?.kind === 'bucket' && bucket
    ? ([bucket.start, bucket.end] as const)
    : undefined
})
const selectionText = computed(() => {
  if (!active.value) return undefined
  const { at, kind } = active.value
  if (kind === 'point') {
    const point = observations.value.get(at)
    return [
      stamps(at),
      point?.state && MONITOR_HISTORY_LABELS[point.state],
      point?.latencyMs == null ? null : point.latencyMs + ' ms',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const bucket = activeBucket.value
  if (!bucket) return undefined
  const point = bucket.count === 1 ? observations.value.get(bucket.focusAt) : undefined
  const status = MONITOR_HISTORY_LABELS[bucket.state]
  const from = stamps(bucket.start)
  const to = stamps(bucket.end)
  return [
    `${from}–${from.slice(0, 10) === to.slice(0, 10) ? to.slice(11) : to}`,
    bucket.count > 1 ? `${bucket.count} 条记录，含${status}` : status,
    point?.latencyMs == null ? null : point.latencyMs + ' ms',
  ]
    .filter(Boolean)
    .join(' · ')
})

function selection(kind: Selection['kind'], index: number): Selection | null {
  const at = kind === 'bucket' ? buckets.value[index]?.focusAt : latency.value[index]?.at
  return at === undefined ? null : { kind, at }
}
function browse(kind: Selection['kind'], index: number | null) {
  if (index !== null) preview.value = selection(kind, index)
  else if (preview.value?.kind === kind) preview.value = null
}
function pin(kind: Selection['kind'], index: number) {
  const next = selection(kind, index)
  if (!next) return
  const current = pinned.value
  const same =
    current?.kind === kind &&
    (kind === 'point' ? current.at === next.at : bucketAt(current.at) === index)
  pinned.value = same ? null : next
  preview.value = null
}
function clearSelection() {
  if (!active.value) return false
  preview.value = pinned.value = null
  return true
}
watch([past, windowRange], () => {
  preview.value = null
  const current = pinned.value
  if (
    current &&
    (current.kind === 'point'
      ? observations.value.get(current.at)?.latencyMs == null
      : bucketAt(current.at) < 0)
  )
    pinned.value = null
})
</script>

<template>
  <section ref="root" class="monitor-history detail-chart" aria-label="服务历史">
    <p v-if="loading" class="quiet-note monitor-history-loading" role="status">正在读取服务历史…</p>
    <p v-else-if="failed" class="quiet-note" role="status">
      历史暂时无法读取。<button type="button" class="chart-text-button" @click="load">重试</button>
    </p>
    <p v-else-if="!past.length" class="quiet-note" role="status">暂无可查看的历史。</p>
    <template v-else>
      <ChartsStatusTimeline
        v-if="buckets.length"
        :selected="statusIndex"
        :buckets="buckets"
        :selection-text="selectionText"
        @preview="browse('bucket', $event)"
        @commit="pin('bucket', $event)"
      />
      <div v-if="history?.showLatency">
        <h4>响应时间</h4>
        <ChartsTimeSeriesChart
          :model-value="latencyIndex"
          :points="latency"
          :domain="windowRange"
          :highlight-range="highlightRange"
          :selection-text="selectionText"
          label="服务响应时间"
          type="line"
          unit="ms"
          :time-label="scaleTime"
          :point-time-label="stamps"
          linked
          @preview="browse('point', $event)"
          @commit="pin('point', $event)"
        />
      </div>
      <p class="monitor-history-readout" aria-live="polite">{{ selectionText }}</p>
    </template>
  </section>
</template>
