<script setup lang="ts">
import type { ChartOption, ChartPalette } from '../../utils/chart-options'
import type { createChart } from '../../utils/chart-engine'

const props = defineProps<{
  label: string
  values: readonly number[]
  details: readonly string[]
  options: (palette: ChartPalette) => ChartOption
  compact?: boolean
  linked?: boolean
  selectable?: readonly number[]
  range?: readonly [number, number]
  selectionText?: string
}>()
const emit = defineEmits<{ preview: [index: number | null]; commit: [index: number] }>()
const active = defineModel<number | null>({ required: true })
const plot = useTemplateRef<HTMLDivElement>('plot')
let chart: ReturnType<typeof createChart> | undefined
let resize: ResizeObserver | undefined
let theme: MutationObserver | undefined
let alive = true
let frame = 0
let positions: number[] = []
const marker = ref<number>()
const band = ref<{ left: string; width: string }>()
const failed = ref(false)
const detailId = useId()
const detail = computed(() =>
  props.linked
    ? props.selectionText
    : (props.details[active.value ?? -1] ?? '用方向键或点按查看数据'),
)
function syncMarker() {
  marker.value = active.value === null ? undefined : positions[active.value]
  const range = props.range?.map((value) => chart?.convertToPixel({ xAxisIndex: 0 }, value))
  band.value = range?.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? { left: `${range[0]}px`, width: `${Math.max(1, Number(range[1]) - Number(range[0]))}px` }
    : undefined
}
function render() {
  if (!chart || !plot.value?.clientWidth) return
  const style = getComputedStyle(plot.value)
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  chart.resize()
  chart.setOption(
    {
      animation: false,
      ...props.options({
        primary: color('--n-primary', '#6750a4'),
        text: color('--n-text', '#1d1b20'),
        muted: color('--n-muted', '#49454f'),
        outline: color('--n-outline', '#79747e'),
        success: color('--color-success', '#218359'),
        danger: color('--color-danger', '#b3261e'),
        warning: color('--color-warning', '#946200'),
        info: color('--color-tertiary', '#5365a0'),
      }),
    },
    { notMerge: true },
  )
  positions = props.values.map((x) => chart!.convertToPixel({ xAxisIndex: 0 }, x) as number)
  syncMarker()
}
function queueRender() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    render()
  })
}
onMounted(async () => {
  try {
    const { createChart } = await import('../../utils/chart-engine')
    if (!alive || !plot.value) return
    chart = createChart(plot.value)
    resize = new ResizeObserver(queueRender)
    resize.observe(plot.value)
    theme = new MutationObserver(queueRender)
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-nozoki-mode'],
    })
    queueRender()
  } catch {
    if (alive) failed.value = true
  }
})
watch([() => props.options, () => props.values], queueRender, { flush: 'post' })
watch([active, () => props.range], syncMarker)
onBeforeUnmount(() => {
  alive = false
  resize?.disconnect()
  theme?.disconnect()
  if (frame) cancelAnimationFrame(frame)
  chart?.dispose()
})

const choices = computed(() => props.selectable ?? props.values.map((_, index) => index))
function pick(event: MouseEvent, commit: boolean) {
  if (!plot.value || !positions.length || !choices.value.length) return
  const x = event.clientX - plot.value.getBoundingClientRect().left
  let nearest = choices.value[0]!
  for (const index of choices.value)
    if (Math.abs(x - positions[index]!) < Math.abs(x - positions[nearest]!)) nearest = index
  if (!props.linked) active.value = nearest
  else if (props.selectable && Math.abs(x - positions[nearest]!) > 16) emit('preview', null)
  else if (commit) emit('commit', nearest)
  else emit('preview', nearest)
}
function key(event: KeyboardEvent) {
  const end = choices.value.length - 1
  if (end < 0) return
  const selected = active.value === null ? -1 : choices.value.indexOf(active.value)
  let next: number
  switch (event.key) {
    case 'Home':
      next = 0
      break
    case 'End':
      next = end
      break
    case 'ArrowLeft':
    case 'ArrowDown':
      next = selected < 0 && props.linked ? end : selected - 1
      break
    case 'ArrowRight':
    case 'ArrowUp':
      next = selected + 1
      break
    case 'Enter':
    case ' ':
      if (!props.linked) return
      event.preventDefault()
      emit('commit', choices.value[Math.max(0, selected)]!)
      return
    default:
      return
  }
  event.preventDefault()
  const index = choices.value[Math.max(0, Math.min(end, next))]!
  if (props.linked) emit('preview', index)
  else active.value = index
}
</script>

<template>
  <div class="chart-figure" :class="{ 'chart-figure-dense': compact }">
    <div
      class="chart-interaction"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="1"
      :aria-valuemax="values.length"
      :aria-valuenow="(active ?? 0) + 1"
      :aria-valuetext="detail || undefined"
      :aria-describedby="linked ? undefined : detailId"
      @keydown="key"
      @pointermove="(event) => event.pointerType === 'mouse' && pick(event, false)"
      @pointerleave="linked && emit('preview', null)"
      @blur="linked && emit('preview', null)"
      @click="pick($event, true)"
    >
      <div ref="plot" class="chart-plot" aria-hidden="true" />
      <i v-if="band" class="chart-band" :style="band" aria-hidden="true" />
      <i
        v-if="marker !== undefined && Number.isFinite(marker)"
        class="chart-marker"
        :style="{ left: marker + 'px' }"
        aria-hidden="true"
      />
    </div>
    <p v-if="failed" class="quiet-note" role="status">图表加载失败，仍可用方向键查看数据。</p>
    <p v-if="!linked" :id="detailId" class="chart-readout">{{ detail }}</p>
  </div>
</template>
