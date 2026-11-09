<script setup lang="ts">
import type { DataSnapshot, Monitor, ServicesData } from '../../../shared/contracts/dashboard'
import { formatTimestamp, decimalText } from '../../../shared/domain/format'
import { monitorStale } from '../../../shared/domain/home-summary'
import { isSafeLink } from '../../../shared/domain/dashboard'
defineProps<{ monitors: Monitor[]; snapshot: DataSnapshot<ServicesData>; detail?: boolean }>()
const timezone = useDashboardTimezone(),
  now = useLocalClock()
const states: Record<Monitor['state'], string> = {
  up: '正常',
  down: '异常',
  maintenance: '维护中',
  pending: '等待检测',
  unknown: '未知',
}
</script>
<template>
  <div class="monitor-list">
    <article
      v-for="monitor in monitors"
      :key="monitor.id"
      class="monitor-row"
      :data-monitor-id="monitor.id"
    >
      <span class="monitor-indicator" :data-state="monitor.state" />
      <div class="monitor-copy">
        <h3 :title="monitor.name">{{ monitor.name }}</h3>
        <div class="monitor-meta">
          <small v-if="monitor.latencyMs !== null && Number.isFinite(monitor.latencyMs)"
            >{{ monitor.latencyMs }} ms</small
          ><small v-if="monitorStale(monitor, snapshot, now)" aria-label="检测数据过期">过期</small>
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
