<script setup lang="ts">
import type { DataSnapshot, Monitor, ServicesData } from '../../../shared/contracts/dashboard'
import { formatTimestamp } from '../../../shared/domain/format'
defineProps<{ snapshot: DataSnapshot<ServicesData>; title: string }>()
const timezone = useDashboardTimezone()
const states: Record<Monitor['state'], string> = {
  up: '正常',
  down: '异常',
  maintenance: '维护中',
  pending: '等待检测',
  unknown: '未知',
}
</script>
<template>
  <DashboardModuleCard
    id="services"
    :title="title"
    :status="snapshot.status"
    :observed-at="snapshot.observedAt"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :empty="!snapshot.data?.monitors.length"
      :last-success-at="snapshot.lastSuccessAt"
    />
    <p v-if="snapshot.partialFailures" class="scope-note" role="status">
      {{ snapshot.partialFailures }} 个监控来源暂不可用，以下为已获取的监控数据。
    </p>
    <div v-if="snapshot.data?.monitors.length" class="monitor-list">
      <article v-for="monitor in snapshot.data.monitors" :key="monitor.id" class="monitor-row">
        <span class="monitor-indicator" :data-state="monitor.state" />
        <div>
          <h3>{{ monitor.name }}</h3>
          <p>检测于 {{ formatTimestamp(monitor.checkedAt, timezone) }}</p>
        </div>
        <div class="monitor-state">
          <strong>{{ states[monitor.state] }}</strong
          ><small>{{ monitor.latencyMs === null ? '延迟未知' : `${monitor.latencyMs} ms` }}</small>
        </div>
      </article>
    </div>
  </DashboardModuleCard>
</template>
