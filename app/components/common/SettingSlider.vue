<script setup lang="ts">
const model = defineModel<number>({ required: true })
const props = withDefaults(defineProps<{ label: string; max?: number; unit?: string }>(), {
  max: 100,
  unit: '%',
})
const host = useTemplateRef<HTMLDivElement>('host')
let activePointer: number | null = null
function updatePointer(event: PointerEvent) {
  const track = host.value?.querySelector('.var-slider__horizontal-block')
  const rect = track?.getBoundingClientRect()
  if (!rect?.width) return
  model.value = Math.max(
    0,
    Math.min(props.max, Math.round(((event.clientX - rect.left) / rect.width) * props.max)),
  )
}
function startPointer(event: PointerEvent) {
  if (
    event.button !== 0 ||
    activePointer !== null ||
    !(event.target as Element).closest('.var-slider__horizontal-block')
  )
    return
  // Varlet measures hidden Popup width at mount and only listens for touch drags.
  // Measure the visible track per input; Pointer Events cover mouse, touch and pen.
  event.preventDefault()
  event.stopPropagation()
  activePointer = event.pointerId
  host.value?.setPointerCapture(event.pointerId)
  ;(host.value?.querySelector('[role="slider"]') as HTMLElement)?.focus({ preventScroll: true })
  updatePointer(event)
}
function movePointer(event: PointerEvent) {
  if (event.pointerId !== activePointer) return
  event.preventDefault()
  updatePointer(event)
}
function endPointer(event: PointerEvent) {
  if (event.pointerId !== activePointer) return
  activePointer = null
  if (host.value?.hasPointerCapture(event.pointerId))
    host.value.releasePointerCapture(event.pointerId)
}
onBeforeUnmount(() => {
  if (activePointer !== null && host.value?.hasPointerCapture(activePointer))
    host.value.releasePointerCapture(activePointer)
  activePointer = null
})
function labelThumb() {
  const thumb = host.value?.querySelector('[role="slider"]')
  thumb?.setAttribute('aria-label', props.label)
  // Varlet 3.20.7 exposes its normalized position as aria-valuenow (wrong for a 0–20 range).
  thumb?.setAttribute('aria-valuenow', String(model.value))
  thumb?.setAttribute('aria-valuetext', `${model.value}${props.unit}`)
}
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  model.value = event.key === 'Home' ? 0 : props.max
}
onMounted(labelThumb)
onUpdated(labelThumb)
</script>
<template>
  <div
    ref="host"
    class="setting-slider"
    @keydown="onKey"
    @pointerdown.capture="startPointer"
    @pointermove="movePointer"
    @pointerup="endPointer"
    @pointercancel="endPointer"
    @lostpointercapture="endPointer"
    @touchstart.capture.stop
    @touchmove.capture.stop
    @click.capture.stop.prevent
  >
    <div class="slider-caption">
      <span>{{ label }}</span
      ><output>{{ model }}{{ unit }}</output>
    </div>
    <VarSlider v-model="model" :min="0" :max="max" :step="1" label-visible="never" />
  </div>
</template>
