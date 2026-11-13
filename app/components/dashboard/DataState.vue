<script setup lang="ts">
import type { DataStatus } from '../../../shared/contracts/dashboard'
import { summaryStatus } from '../../../shared/domain/summary-status'
withDefaults(
  defineProps<{
    configured?: boolean
    errorCode?: string
    status: DataStatus
    empty?: boolean
    loading?: boolean
    compact?: boolean
    hasData?: boolean
    lastSuccessAt?: string | null
  }>(),
  { empty: false, loading: false, compact: false, lastSuccessAt: null },
)
const labels: Record<DataStatus, string> = {
  ok: '暂无数据',
  stale: '',
  error: '采集失败',
  unconfigured: '尚未配置数据源',
  unsupported: '来源不支持此能力',
  offline: '来源已确认离线',
}
const timezone = useDashboardTimezone()
const notes: Partial<Record<DataStatus, string>> = {
  error: '采集失败不代表监控对象离线',
  offline: '离线状态由来源明确报告',
}
</script>
<template>
  <div
    v-if="
      loading ||
      (status !== 'stale' && (status !== 'ok' || empty) && !(hasData && summaryStatus(status)))
    "
    class="data-state"
    :class="{ compact }"
    :data-status="status"
    role="status"
    :aria-busy="loading"
  >
    <div>
      <span>{{
        loading
          ? '正在加载'
          : status === 'unconfigured' && errorCode === 'SOURCE_DISABLED'
            ? '来源已停用'
            : status === 'unconfigured' && configured
              ? errorCode === 'NOT_CONFIGURED'
                ? '来源配置尚未完成'
                : '来源已匹配，等待采集结果'
              : labels[status]
      }}</span
      ><small v-if="!compact && notes[status]">{{ notes[status] }}</small
      ><small v-if="status === 'error' && lastSuccessAt"
        >最近成功 {{ formatTimestamp(lastSuccessAt, timezone) }}</small
      >
    </div>
  </div>
</template>
<script lang="ts">
import { formatTimestamp } from '../../../shared/domain/format'
</script>
