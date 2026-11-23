<script setup lang="ts">
import type { ChartPoint } from '../../../shared/domain/chart-series'
import type { ChartOption, ChartPalette } from '../../utils/chart-options'

const props = defineProps<{
  label: string
  points: readonly ChartPoint[]
  type: 'line' | 'bar'
  timeLabel?: (at: number) => string
  pointTimeLabel?: (at: number) => string
  unit?: string
  linked?: boolean
  domain?: readonly [number, number]
  highlightRange?: readonly [number, number]
  selectionText?: string
  pinRevision?: number
}>()
const emit = defineEmits<{ preview: [index: number | null]; commit: [index: number] }>()
const selected = defineModel<number | null>({ default: null })
const hasValues = computed(() => props.points.some((p) => p.value !== null))
const selectable = computed(() =>
  props.linked ? props.points.flatMap(({ value }, i) => (value === null ? [] : [i])) : undefined,
)
const x = computed(() => props.points.map((p, i) => (props.timeLabel ? p.at! : i)))
const details = computed(() =>
  props.points.map((point) =>
    [
      props.timeLabel && point.at !== undefined
        ? (props.pointTimeLabel ?? props.timeLabel)(point.at)
        : point.label,
      point.display,
      point.detail,
    ]
      .filter(Boolean)
      .join(' · '),
  ),
)
const options = computed(() => {
  const { type, points, timeLabel, unit, domain } = props
  const values = points.map((point) => point.value)
  return (color: ChartPalette): ChartOption => ({
    grid: { top: 14, left: 10, right: 18, bottom: 8, containLabel: true },
    xAxis: {
      ...(timeLabel
        ? { type: 'time' as const, splitNumber: 3, min: domain?.[0], max: domain?.[1] }
        : {
            type: 'category' as const,
            data: points.map((point) => point.label),
            boundaryGap: type === 'bar',
          }),
      axisLabel: {
        color: color.muted,
        hideOverlap: true,
        ...(timeLabel ? { formatter: (value: number | string) => timeLabel(Number(value)) } : {}),
      },
      axisLine: { lineStyle: { color: color.outline } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: type === 'line' && !timeLabel,
      splitNumber: 3,
      axisLabel: { color: color.muted, formatter: unit === 'ms' ? '{value} ms' : '{value}' },
      splitLine: { lineStyle: { color: color.outline } },
    },
    series:
      type === 'line'
        ? [
            {
              type: 'line',
              data: timeLabel ? points.map((point) => [point.at!, point.value]) : values,
              connectNulls: false,
              showSymbol: true,
              symbolSize: 4,
              lineStyle: { color: color.primary, width: 2 },
              itemStyle: { color: color.primary },
            },
          ]
        : [
            {
              type: 'bar',
              barMaxWidth: 32,
              barMinHeight: 2,
              data: values.map((value) => ({
                value,
                itemStyle: { color: value !== null && value < 0 ? color.danger : color.primary },
              })),
            },
          ],
  })
})
</script>
<template>
  <ChartsPlot
    v-if="hasValues"
    v-model="selected"
    :label="label"
    :values="x"
    :details="details"
    :options="options"
    :linked="linked"
    :selectable="selectable"
    :range="highlightRange"
    :selection-text="selectionText"
    :pin-revision="pinRevision"
    @preview="emit('preview', $event)"
    @commit="emit('commit', $event)"
  />
  <p v-else class="quiet-note">{{ linked ? '暂无响应时间记录。' : '暂无历史数据。' }}</p>
</template>
