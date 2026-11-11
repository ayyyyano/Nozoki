<script setup lang="ts">
import type { DataSnapshot, Monitor, ServicesData } from '../../../shared/contracts/dashboard'
import { formatTimestamp, decimalText } from '../../../shared/domain/format'
import {
  monitorDisplayState,
  monitorLatency,
  monitorName,
} from '../../../shared/domain/home-summary'
import { isSafeLink } from '../../../shared/domain/dashboard'
const props = defineProps<{
  monitors: Monitor[]
  snapshot: DataSnapshot<ServicesData>
  detail?: boolean
}>()
const timezone = useDashboardTimezone(),
  now = useLocalClock()
const states: Record<Monitor['state'] | 'stale', string> = {
  up: '正常',
  down: '异常',
  maintenance: '维护中',
  pending: '等待检测',
  unknown: '未知',
  stale: '已过期',
}
const rows = computed(() =>
  props.monitors.map((monitor) => ({
    ...monitor,
    name: monitorName(monitor.name, monitor.displayId ?? monitor.id),
    state: monitorDisplayState(monitor, props.snapshot, now.value),
    latencyMs: monitorLatency(monitor.latencyMs),
  })),
)
</script>
<template>
  <div class="monitor-list" :class="{ 'monitor-list-detail': detail }">
    <article
      v-for="monitor in rows"
      :key="monitor.id"
      class="monitor-row"
      :data-monitor-id="monitor.id"
    >
      <span class="monitor-indicator" :data-state="monitor.state" />
      <div class="monitor-copy">
        <h3 :title="monitor.name">{{ monitor.name }}</h3>
        <div
          v-if="
            (detail && monitor.displayId && monitor.displayId !== monitor.name) ||
            monitor.latencyMs !== null
          "
          class="monitor-meta"
        >
          <small v-if="detail && monitor.displayId && monitor.displayId !== monitor.name">{{
            monitor.displayId
          }}</small>
          <small
            v-if="
              detail &&
              monitor.displayId &&
              monitor.displayId !== monitor.name &&
              monitor.latencyMs !== null
            "
            aria-hidden="true"
            >·</small
          >
          <small v-if="monitor.latencyMs !== null">{{ monitor.latencyMs }} ms</small>
        </div>
        <template v-if="detail"
          ><p v-if="monitor.checkedAt">检测于 {{ formatTimestamp(monitor.checkedAt, timezone) }}</p>
          <p v-if="monitor.uptimePercent !== null">
            可用率 {{ decimalText(monitor.uptimePercent) }}%
          </p>
          <a
            v-if="monitor.statusPageUrl && isSafeLink(monitor.statusPageUrl)"
            :href="monitor.statusPageUrl"
            target="_blank"
            rel="noopener noreferrer"
            >状态页面</a
          ></template
        >
      </div>
      <strong class="monitor-state">{{ states[monitor.state] ?? '未知' }}</strong>
    </article>
  </div>
</template>
