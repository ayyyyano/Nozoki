<script setup lang="ts">
import type { DxBoot, DxBootSnapshot, DxBootWindow } from '../../../shared/browser/dx-boot'
const props = defineProps<{ reduced: boolean; themeReady: boolean }>()
const initiallyPlayed = useState('nozoki-dx-initial-played', () => false)
const background = useState<'loading' | 'loaded' | 'failed' | 'off'>(
  'nozoki-background-state',
  () => 'loading',
)
const veil = useTemplateRef<HTMLElement>('veil')
const artwork = useTemplateRef<HTMLElement>('artwork')
const visual = useMaimaiVisual(artwork)
const {
  phase,
  start,
  cancel: cancelLocal,
  resources,
} = useDxTransition(veil, toRef(props, 'reduced'), visual)
let initial: DxBoot | undefined
const initialRunning = ref(false)
const initialState = shallowRef<DxBootSnapshot>({
  phase: 'idle',
  timers: 0,
  frames: 0,
  listeners: 0,
})
let detachInitial: (() => void) | undefined
let stopReadiness: (() => void) | undefined
let backgroundBudget: ReturnType<typeof setTimeout> | undefined
const backgroundWaiting = ref(false)
function clearBackgroundBudget() {
  clearTimeout(backgroundBudget)
  backgroundBudget = undefined
  backgroundWaiting.value = false
}
function notifyInitialReady() {
  clearBackgroundBudget()
  void nextTick().then(() => initial?.ready())
}
function cancel() {
  initial?.cancel()
  cancelLocal()
}
watch(
  () => props.reduced,
  (value) => {
    if (value) initial?.cancel()
  },
)
watch(phase, (value) => {
  if (value === 'idle') visual.dispose()
})
function ready(signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    let stop: (() => void) | undefined
    const done = () => {
      stop?.()
      signal?.removeEventListener('abort', done)
      resolve()
    }
    if (signal?.aborted || (props.themeReady && background.value !== 'loading')) {
      resolve()
      return
    }
    stop = watch([() => props.themeReady, background], ([theme, image]) => {
      if (theme && image !== 'loading') done()
    })
    signal?.addEventListener('abort', done, { once: true })
  })
}
let abort: AbortController | undefined
let playing: Promise<unknown> | undefined
function play(initialization?: () => Promise<unknown>) {
  if (initialRunning.value && initial) return initial.done
  if (playing) return playing
  abort = new AbortController()
  const current = abort
  playing = start(initialization ?? (() => ready(current.signal))).finally(() => {
    current.abort()
    playing = undefined
  })
  return playing
}
onMounted(() => {
  ;(window as DxBootWindow).__NOZOKI_DX_APP_MOUNTED__ = true
  if (initiallyPlayed.value) return
  initiallyPlayed.value = true
  initial = (window as DxBootWindow).__NOZOKI_DX_BOOT__
  if (initial) {
    initialRunning.value = initial.snapshot().phase !== 'idle'
    detachInitial = initial.subscribe((state) => {
      initialState.value = state
    })
    stopReadiness = watch(
      [() => props.themeReady, background],
      ([theme, image]) => {
        if (!theme) return
        if (image !== 'loading' || initial?.snapshot().phase === 'boot') notifyInitialReady()
        else if (backgroundBudget === undefined) {
          backgroundWaiting.value = true
          backgroundBudget = setTimeout(notifyInitialReady, 900)
        }
      },
      { immediate: true },
    )
    void initial.done.finally(() => {
      initialRunning.value = false
      detachInitial?.()
      detachInitial = undefined
      stopReadiness?.()
      stopReadiness = undefined
      clearBackgroundBudget()
    })
    return
  }
  // Missing or late bootstrap falls back to the already visible SSR page, never a late cover.
  ;(window as DxBootWindow).__NOZOKI_DX_CURTAIN__?.cancel()
})
onBeforeUnmount(() => {
  abort?.abort()
  cancel()
  visual.dispose()
  detachInitial?.()
  stopReadiness?.()
  clearBackgroundBudget()
})
// Development-only diagnostics are attached by the separate, tree-shaken fixture panel.
const ownedResources = computed(() => ({
  ...(initialRunning.value ? initialState.value : resources),
  timers:
    (initialRunning.value ? initialState.value.timers : resources.timers) +
    Number(backgroundWaiting.value),
  frames: initialRunning.value
    ? initialState.value.frames
    : resources.frames + visual.pendingFrames.value,
}))
const exposedPhase = computed(() => (initialRunning.value ? initialState.value.phase : phase.value))
defineExpose({ play, cancel, resources: ownedResources, phase: exposedPhase })
</script>
<template>
  <div v-if="phase !== 'idle'" class="dx-transition" :data-phase="phase" aria-hidden="true">
    <div ref="veil" class="dx-veil" />
    <div ref="artwork" class="dx-geometry" />
  </div>
</template>
