<script setup lang="ts">
import type { ChartPoint } from '../../../shared/domain/chart-series'
const props = defineProps<{ label: string; type: 'line' | 'bar'; points: readonly ChartPoint[] }>()
const domain = computed(() => {
  const values = props.points.flatMap((p) => (p.value === null ? [] : [p.value]))
  if (props.type === 'bar' || !values.length) values.push(0)
  const max = Math.max(...values)
  const min = Math.min(...values)
  return { max, min, span: max - min || 1 }
})
function height(value: number) {
  const { max, min, span } = domain.value
  return max === min ? 100 : ((max - value) / span) * 100
}
const pointsPath = computed(() => {
  if (props.points.length < 2) return ''
  const { max, span } = domain.value
  let pen = 'M'
  return props.points
    .map((point, i) => {
      if (point.value === null) {
        pen = 'M'
        return ''
      }
      const x = (i / (props.points.length - 1)) * 240
      const y = 7 + ((max - point.value) / span) * 42
      const command = pen
      pen = 'L'
      return command + x + ',' + y
    })
    .join(' ')
})
</script>
<template>
  <div v-if="type === 'bar'" class="balance-bars" :aria-label="label">
    <div
      v-for="point in points"
      :key="point.key"
      class="balance-bar"
      :class="{ 'balance-bar-missing': point.value === null }"
      tabindex="0"
      :title="[point.key, point.display, point.detail].filter(Boolean).join(' · ')"
      :aria-label="[point.key, point.display, point.detail].filter(Boolean).join(' · ')"
    >
      <span
        v-if="point.value !== null"
        class="balance-bar-value"
        :style="{
          transform: `translateY(${Math.min(97, height(point.value), height(0)) * 0.76}px)`,
        }"
        >{{ point.display.split(' ')[0] }}</span
      >
      <div class="balance-bar-track">
        <i
          v-if="point.value !== null"
          :class="{ 'balance-negative': point.value < 0 }"
          :style="{
            top: `min(${Math.min(height(point.value), height(0))}%, calc(100% - 3px))`,
            height: `${Math.abs(height(point.value) - height(0))}%`,
          }"
        />
        <span v-else>—</span>
      </div>
      <small>{{ point.label }}</small>
    </div>
  </div>
  <svg
    v-else-if="pointsPath"
    class="quote-chart"
    viewBox="0 0 240 56"
    role="img"
    :aria-label="label"
  >
    <path :d="pointsPath" fill="none" stroke="currentColor" stroke-width="2" />
  </svg>
</template>
