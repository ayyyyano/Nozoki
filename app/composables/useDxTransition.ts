import { createDxController, type DxPhase } from '../../shared/domain/dx-transition'

export function useDxTransition(
  veil: Ref<HTMLElement | null>,
  reduced: Ref<boolean>,
  visual?: {
    prepare(signal: AbortSignal): Promise<void>
    draw(
      phase: 'entering' | 'leaving',
    ): { element: Element; name: string; animation: CSSAnimation } | undefined
  },
) {
  const phase = ref<DxPhase>('idle')
  // Diagnostics count only resources owned by this transition, never application-wide listeners.
  const resources = reactive({ timers: 0, frames: 0, listeners: 0 })
  const timerIds = new Set<ReturnType<typeof setTimeout>>()
  function setTimer(callback: () => void, delay: number) {
    const id = setTimeout(() => {
      timerIds.delete(id)
      resources.timers = timerIds.size
      callback()
    }, delay)
    timerIds.add(id)
    resources.timers = timerIds.size
    return id
  }
  function clearTimer(id: ReturnType<typeof setTimeout>) {
    clearTimeout(id)
    timerIds.delete(id)
    resources.timers = timerIds.size
  }
  async function frame(signal: AbortSignal) {
    if (visual) {
      // Only local visual assets; a finite abortable budget prevents an unavailable SVG blocking SSR.
      const assetAbort = new AbortController()
      const cancelAsset = () => assetAbort.abort()
      signal.addEventListener('abort', cancelAsset, { once: true })
      const budget = setTimer(() => assetAbort.abort(), 1800)
      try {
        await visual.prepare(assetAbort.signal)
      } finally {
        assetAbort.abort()
        clearTimer(budget)
        signal.removeEventListener('abort', cancelAsset)
      }
    }
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      let frameId = 0
      let fallback: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        cancelAnimationFrame(frameId)
        if (fallback !== undefined) clearTimer(fallback)
        signal.removeEventListener('abort', cancel)
        resources.frames--
        resources.listeners--
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      const cancel = () => {
        cleanup()
        reject(signal.reason)
      }
      resources.frames++
      resources.listeners++
      signal.addEventListener('abort', cancel, { once: true })
      frameId = requestAnimationFrame(finish)
      fallback = setTimer(finish, 100)
    })
  }
  async function animate(stage: 'entering' | 'leaving', signal: AbortSignal) {
    await nextTick()
    if (signal.aborted) throw signal.reason
    const marker = visual?.draw(stage)
    const element = marker?.element ?? veil.value
    if (!element) return
    const name = marker?.name ?? (stage === 'entering' ? 'nozoki-dx-cover' : 'nozoki-dx-reveal')
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        element.removeEventListener('animationend', ended)
        element.removeEventListener('animationcancel', interrupted)
        marker?.animation.removeEventListener('finish', finished)
        signal.removeEventListener('abort', cancel)
        clearTimer(fallback)
        resources.listeners -= marker ? 4 : 3
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      const cancel = () => {
        cleanup()
        reject(signal.reason)
      }
      const ended = (event: Event) => {
        if (event.target === element && (event as AnimationEvent).animationName === name) finish()
      }
      const interrupted = (event: Event) => {
        if (event.target === element && (event as AnimationEvent).animationName === name) finish()
      }
      const finished = () => finish()
      const fallback = setTimer(finish, marker ? 2400 : stage === 'entering' ? 450 : 550)
      resources.listeners += marker ? 4 : 3
      element.addEventListener('animationend', ended)
      element.addEventListener('animationcancel', interrupted)
      signal.addEventListener('abort', cancel, { once: true })
      marker?.animation.addEventListener('finish', finished)
    })
  }
  const controller = createDxController({
    frame,
    animate,
    reduced: () => reduced.value,
    hidden: () => document.hidden,
    phase: (value) => {
      phase.value = value
    },
    setTimer,
    clearTimer,
    report: (error) => {
      if (import.meta.dev) console.warn('DX initialization fallback', error)
    },
  })
  let detach: (() => void) | undefined
  async function start(ready: () => Promise<unknown>) {
    // Only the active run owns a visibility listener. Duplicate requests share its result.
    if (controller.running) return controller.start(ready)
    const hidden = () => {
      if (document.hidden) controller.cancel()
    }
    document.addEventListener('visibilitychange', hidden)
    resources.listeners++
    let removed = false
    const remove = () => {
      if (removed) return
      removed = true
      document.removeEventListener('visibilitychange', hidden)
      resources.listeners--
      if (detach === remove) detach = undefined
    }
    detach = remove
    try {
      return await controller.start(ready)
    } finally {
      remove()
    }
  }
  function cancel() {
    controller.cancel()
    detach?.()
  }
  watch(reduced, (value) => {
    if (value) cancel()
  })
  onBeforeUnmount(cancel)
  if (import.meta.hot) import.meta.hot.dispose(cancel)
  return { phase, start, cancel, resources }
}
