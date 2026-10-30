import { createMaimaiVisual } from '../../shared/browser/maimai-visual'

export function useMaimaiVisual(host: Ref<HTMLElement | null>) {
  const pendingFrames = ref(0)
  const visual = createMaimaiVisual(
    () => host.value,
    (count) => {
      pendingFrames.value = count
    },
  )
  return {
    async prepare(signal: AbortSignal) {
      await nextTick()
      return visual.prepare(signal)
    },
    draw: visual.draw,
    dispose: visual.dispose,
    pendingFrames,
  }
}
