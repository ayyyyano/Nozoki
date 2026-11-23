<script setup lang="ts">
import type { DataSnapshot, Monitor, ServicesData } from '../../../shared/contracts/dashboard'
import {
  HOME_HISTORY_SEGMENTS,
  type HomeMonitorHistory,
} from '../../../shared/contracts/service-history'
import { MONITOR_HISTORY_LABELS } from '../../../shared/domain/chart-series'
import {
  monitorDisplayState,
  monitorLatency,
  monitorName,
} from '../../../shared/domain/home-summary'
import { isSafeLink } from '../../../shared/domain/dashboard'
const props = defineProps<{
  monitors: Monitor[]
  snapshot: DataSnapshot<ServicesData>
  history?: ReadonlyMap<string, HomeMonitorHistory['segments']>
  revision?: string
  detail?: boolean
}>()
const now = useLocalClock()
const headingId = useId()
const states = { ...MONITOR_HISTORY_LABELS, stale: '数据过期' }
const rows = computed(() =>
  props.monitors.map((monitor) => ({
    ...monitor,
    name: monitorName(monitor.name, monitor.displayId ?? monitor.id),
    state: monitorDisplayState(monitor, props.snapshot, now.value),
    latencyMs: monitorLatency(monitor.latencyMs),
    statusPageUrl:
      monitor.statusPageUrl && isSafeLink(monitor.statusPageUrl) ? monitor.statusPageUrl : null,
  })),
)
const desktop = ref(false)
const expanded = ref<string | null>(null)
let breakpoint: MediaQueryList | undefined
function syncDesktop() {
  desktop.value = breakpoint?.matches ?? false
  expanded.value = null
}
onMounted(() => {
  if (!props.detail) return
  breakpoint = window.matchMedia('(min-width: 1024px)')
  syncDesktop()
  breakpoint.addEventListener('change', syncDesktop)
})
onBeforeUnmount(() => breakpoint?.removeEventListener('change', syncDesktop))
watch(rows, (next) => {
  if (expanded.value && !next.some(({ id }) => id === expanded.value)) expanded.value = null
})
</script>

<template>
  <div
    v-if="rows.length"
    class="monitor-list"
    :class="detail ? 'monitor-list-detail' : 'monitor-list-home'"
  >
    <article
      v-for="(monitor, index) in rows"
      :key="monitor.id"
      class="monitor-row"
      :data-monitor-id="monitor.id"
      :aria-labelledby="`${headingId}-name-${index}`"
    >
      <div class="monitor-heading">
        <span class="monitor-indicator" :data-state="monitor.state" aria-hidden="true" />
        <div class="monitor-copy">
          <h3 :id="`${headingId}-name-${index}`" :title="monitor.name">
            <a
              v-if="monitor.statusPageUrl"
              class="monitor-name-link"
              :href="monitor.statusPageUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ monitor.name }}</a
            >
            <template v-else>{{ monitor.name }}</template>
          </h3>
          <p v-if="detail" class="monitor-meta">
            <template v-if="monitor.displayId && monitor.displayId !== monitor.name">
              {{ monitor.displayId }} ·
            </template>
            {{ monitor.latencyMs === null ? '—' : monitor.latencyMs + ' ms' }}
          </p>
        </div>
        <strong
          v-if="detail || monitor.state !== 'up'"
          class="monitor-state"
          :data-state="monitor.state"
          >{{ states[monitor.state] }}</strong
        >
        <span v-else class="monitor-latency">
          <span class="sr-only">正常 · </span>
          {{ monitor.latencyMs === null ? '—' : monitor.latencyMs + ' ms' }}
        </span>
        <button
          v-if="detail && !desktop"
          type="button"
          class="monitor-history-toggle"
          :aria-label="`${expanded === monitor.id ? '收起' : '展开'}${monitor.name}的历史`"
          :aria-expanded="expanded === monitor.id"
          :aria-controls="`${headingId}-history-${index}`"
          @click="expanded = expanded === monitor.id ? null : monitor.id"
        >
          <CommonAppIcon name="chevronDown" :size="20" />
        </button>
      </div>
      <div v-if="detail" :id="`${headingId}-history-${index}`">
        <Transition name="monitor-history-reveal">
          <DashboardMonitorHistory
            v-if="desktop || expanded === monitor.id"
            :monitor-id="monitor.id"
            :revision="revision ?? ''"
          />
        </Transition>
      </div>
      <div v-else class="monitor-heartbeat" aria-hidden="true">
        <div
          v-for="count in HOME_HISTORY_SEGMENTS"
          :key="count"
          class="monitor-heartbeat-segments"
          :data-segments="count"
        >
          <span
            v-for="(state, segment) in history?.get(monitor.id)?.[count]"
            :key="segment"
            :data-state="state"
          />
        </div>
      </div>
      <span v-if="!detail && history?.has(monitor.id)" class="sr-only">
        近 12 小时心跳：{{
          history
            ?.get(monitor.id)?.[12]
            .map((state) => states[state])
            .join('、')
        }}
      </span>
    </article>
  </div>
</template>
