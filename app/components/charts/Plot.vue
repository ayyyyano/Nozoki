<script setup lang="ts">
import type { ChartOption, ChartPalette } from '../../utils/chart-options'
import type { createChart } from '../../utils/chart-engine'

const props = defineProps<{
  label: string
  values: readonly number[]
  pointKeys?: readonly string[]
  details: readonly string[]
  options: (palette: ChartPalette) => ChartOption
  compact?: boolean
  linked?: boolean
  selectable?: readonly number[]
  range?: readonly [number, number]
  selectionText?: string
  pinRevision?: number
}>()
const emit = defineEmits<{ preview: [index: number | null]; commit: [index: number] }>()
const active = defineModel<number | null>({ required: true })
const plot = useTemplateRef<HTMLDivElement>('plot')
const markerElement = useTemplateRef<HTMLElement>('markerElement')
const bandElement = useTemplateRef<HTMLElement>('bandElement')
let chart: ReturnType<typeof createChart> | undefined
let resize: ResizeObserver | undefined
let theme: MutationObserver | undefined
let alive = true
let frame = 0
let positions: number[] = []
const marker = ref<number>()
const band = ref<{ left: string; width: string }>()
const failed = ref(false)
const pinned = ref<string>()
const preview = ref<string>()
const selected = computed(() => {
  if (props.linked) return active.value
  const key = preview.value ?? pinned.value
  const index = key === undefined ? -1 : (props.pointKeys?.indexOf(key) ?? -1)
  return index < 0 ? null : index
})
watch(
  () => props.pointKeys,
  (keys) => {
    if (pinned.value !== undefined && !keys?.includes(pinned.value)) pinned.value = undefined
    if (preview.value !== undefined && !keys?.includes(preview.value)) preview.value = undefined
  },
)
const detail = computed(() =>
  props.linked ? props.selectionText : props.details[selected.value ?? -1],
)
function syncMarker() {
  marker.value = selected.value === null ? undefined : positions[selected.value]
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
watch([selected, () => props.range], syncMarker)
watch(
  () => props.pinRevision,
  () => {
    const highlight = markerElement.value ?? bandElement.value
    if (!highlight) return
    highlight.classList.remove('chart-pin-feedback')
    highlight.getBoundingClientRect()
    highlight.classList.add('chart-pin-feedback')
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  alive = false
  resize?.disconnect()
  theme?.disconnect()
  if (frame) cancelAnimationFrame(frame)
  chart?.dispose()
})

const choices = computed(() => props.selectable ?? props.values.map((_, index) => index))
function browse(index: number | null) {
  if (props.linked) emit('preview', index)
  else preview.value = index === null ? undefined : props.pointKeys?.[index]
}
function pin(index: number) {
  if (props.linked) emit('commit', index)
  else {
    const key = props.pointKeys?.[index]
    pinned.value = pinned.value === key ? undefined : key
    preview.value = undefined
  }
}
function pick(event: MouseEvent, commit: boolean) {
  if (!plot.value || !positions.length || !choices.value.length) return
  const x = event.clientX - plot.value.getBoundingClientRect().left
  let nearest = choices.value[0]!
  for (const index of choices.value)
    if (Math.abs(x - positions[index]!) < Math.abs(x - positions[nearest]!)) nearest = index
  if (props.linked && props.selectable && Math.abs(x - positions[nearest]!) > 16) browse(null)
  else if (commit) pin(nearest)
  else browse(nearest)
}
function key(event: KeyboardEvent) {
  const end = choices.value.length - 1
  if (end < 0) return
  const current = selected.value === null ? -1 : choices.value.indexOf(selected.value)
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
      next = current < 0 ? end : current - 1
      break
    case 'ArrowRight':
    case 'ArrowUp':
      next = current + 1
      break
    case 'Enter':
    case ' ':
      if (!props.linked && current < 0) return
      event.preventDefault()
      pin(choices.value[Math.max(0, current)]!)
      return
    case 'Escape':
      if (props.linked || (preview.value === undefined && pinned.value === undefined)) return
      event.stopPropagation()
      pinned.value = undefined
      browse(null)
      return
    default:
      return
  }
  event.preventDefault()
  browse(choices.value[Math.max(0, Math.min(end, next))]!)
}
</script>

<template>
  <div
    class="chart-figure"
    :class="{ 'chart-figure-dense': compact, 'chart-figure-standalone': !linked }"
  >
    <div
      class="chart-interaction"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="0"
      :aria-valuemax="values.length"
      :aria-valuenow="(selected ?? -1) + 1"
      :aria-valuetext="detail || '未选中'"
      @keydown="key"
      @pointermove="(event) => event.pointerType === 'mouse' && pick(event, false)"
      @pointerleave="browse(null)"
      @blur="browse(null)"
      @click="pick($event, true)"
    >
      <div ref="plot" class="chart-plot" aria-hidden="true" />
      <i v-if="band" ref="bandElement" class="chart-band" :style="band" aria-hidden="true" />
      <i
        v-if="marker !== undefined && Number.isFinite(marker)"
        ref="markerElement"
        class="chart-marker"
        :style="{ left: marker + 'px' }"
        aria-hidden="true"
      />
    </div>
    <p v-if="failed" class="quiet-note" role="status">图表加载失败，仍可用方向键查看数据。</p>
    <p v-if="!linked && detail" class="chart-readout">{{ detail }}</p>
  </div>
</template>
