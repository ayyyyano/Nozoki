<script setup lang="ts">
import {
  RING_LABELS,
  presentRing,
  resetCountdown,
  resetRing,
  type CodexRing,
} from '../../../shared/domain/codex-rings'
import { formatTimestamp } from '../../../shared/domain/format'
const props = defineProps<{ rings: CodexRing[]; now: number; detail?: boolean }>()
const timezone = useDashboardTimezone()
const labels = {
  masked: '已遮蔽',
  unknown: '待同步',
  stale: '已过期',
  unsupported: '不支持',
  unconfigured: '未配置',
}
function percentage(value: number) {
  if (value > 0 && value < 0.1) return '<0.1%'
  if (value > 99.9 && value < 100) return '>99.9%'
  return `${Number(value.toFixed(1))}%`
}
const items = computed(() =>
  props.rings.map((ring) => {
    const value = presentRing(ring, props.now)
    return {
      id: ring.id,
      ...value,
      lastTime: value.last
        ? formatTimestamp(new Date(value.last.observedAt).toISOString(), timezone.value)
        : null,
      progress: resetRing(ring.id),
      text:
        value.percent === null
          ? value.last
            ? percentage(value.last.percent)
            : labels[value.state as keyof typeof labels]
          : percentage(value.percent),
    }
  }),
)
</script>
<template>
  <div v-if="items.length" class="codex-ring-grid" :class="{ 'codex-ring-detail': detail }">
    <div
      v-for="item in items"
      :key="item.id"
      class="codex-ring"
      :data-ring="item.id"
      :data-state="item.state"
    >
      <div class="codex-ring-meter">
        <VarProgress
          v-if="item.percent !== null"
          aria-hidden="true"
          mode="circle"
          :value="item.percent"
          :label="false"
          :size="76"
          :line-width="5"
          :color="item.progress ? 'var(--color-tertiary)' : 'var(--color-primary)'"
        />
        <strong :class="{ 'codex-ring-placeholder': item.percent === null }">{{
          item.text
        }}</strong>
      </div>
      <div class="codex-ring-label">{{ RING_LABELS[item.id] }}</div>
      <small v-if="item.lastTime" :title="item.lastTime">
        {{ item.lastTime.slice(5) }} · 已过期
      </small>
      <small v-if="item.resetIn !== null">距重置 {{ resetCountdown(item.resetIn) }}</small>
      <small v-if="detail && item.resetAt !== null">{{
        formatTimestamp(new Date(item.resetAt).toISOString(), timezone)
      }}</small>
      <span v-if="item.progress && item.percent !== null" class="sr-only">周期已过去比例</span>
    </div>
  </div>
</template>
