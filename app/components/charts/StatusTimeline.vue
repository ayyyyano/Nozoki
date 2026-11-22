<script setup lang="ts">
import type { StatusBucket } from '../../../shared/domain/chart-series'
import type { ChartOption, ChartPalette } from '../../utils/chart-options'
const props = defineProps<{
  buckets: readonly StatusBucket[]
  selected: number | null
  selectionText?: string
}>()
const emit = defineEmits<{ preview: [index: number | null]; commit: [index: number] }>()
const x = computed(() => props.buckets.map((_, i) => i))
const options = computed(() => {
  const buckets = props.buckets
  return (color: ChartPalette): ChartOption => {
    const colors = {
      up: color.success,
      down: color.danger,
      maintenance: color.info,
      pending: color.warning,
      unknown: color.muted,
      missing: color.outline,
    }
    return {
      grid: { top: 3, bottom: 3, left: 2, right: 2 },
      xAxis: { type: 'category', data: buckets.map((_, i) => String(i)), show: false },
      yAxis: { type: 'value', min: 0, max: 1, show: false },
      series: [
        {
          type: 'bar',
          barWidth: '78%',
          barMaxWidth: 14,
          data: buckets.map(({ state }) => ({
            value: 1,
            itemStyle: { color: colors[state], borderRadius: 2 },
          })),
        },
      ],
    }
  }
})
</script>

<template>
  <ChartsPlot
    v-if="buckets.length"
    :model-value="selected"
    :selection-text="selectionText"
    label="服务状态时间轴"
    :values="x"
    :details="[]"
    :options="options"
    linked
    compact
    @preview="emit('preview', $event)"
    @commit="emit('commit', $event)"
  />
</template>
