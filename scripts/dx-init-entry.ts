import { createDxController, type DxPhase } from '../shared/domain/dx-transition'
import { createMaimaiVisual } from '../shared/browser/maimai-visual'
import type { DxBootWindow, DxBootSnapshot } from '../shared/browser/dx-boot'

// Independent head script: never inserts ahead of Vue's body Teleport hydration anchors.
const target = window as DxBootWindow
if (
  !target.__NOZOKI_DX_BOOT__ &&
  !target.__NOZOKI_DX_APP_MOUNTED__ &&
  (!target.__NOZOKI_DX_CURTAIN__ || target.__NOZOKI_DX_CURTAIN__.element.isConnected)
) {
  let phase: DxPhase = 'idle'
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const listeners = new Set<(state: DxBootSnapshot) => void>()
  let ownedListeners = 0
  let visualFrames = 0
  let frameCount = 0
  let overlay: HTMLDivElement | undefined
  let artwork: HTMLDivElement | undefined
  let applicationReady!: () => void
  const readiness = new Promise<void>((resolve) => {
    applicationReady = resolve
  })
  const snapshot = (): DxBootSnapshot => ({
    phase,
    timers: timers.size,
    frames: visualFrames + frameCount,
    listeners: ownedListeners,
  })
  const emit = () => {
    for (const listener of listeners) listener(snapshot())
  }
  const visual = createMaimaiVisual(
    () => artwork ?? null,
    (count) => {
      visualFrames = count
      emit()
    },
  )
  const setTimer = (callback: () => void, delay: number) => {
    const id = setTimeout(() => {
      timers.delete(id)
      emit()
      callback()
    }, delay)
    timers.add(id)
    emit()
    return id
  }
  const clearTimer = (id: ReturnType<typeof setTimeout>) => {
    clearTimeout(id)
    timers.delete(id)
    emit()
  }
  let personalReduced = false
  try {
    personalReduced =
      JSON.parse(localStorage.getItem('nozoki-appearance-v1') ?? 'null')?.reduceMotion === true
  } catch {
    /* Invalid preferences keep the system default. */
  }
  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)')
  const controller = createDxController({
    report: (error) => console.warn('DX early initialization fallback', error),
    reduced: () => personalReduced || systemReduced.matches,
    hidden: () => document.hidden,
    readinessBudgetMs: 10000,
    setTimer,
    clearTimer,
    phase(value) {
      phase = value
      if (value === 'boot') {
        overlay = target.__NOZOKI_DX_CURTAIN__?.claim() ?? document.createElement('div')
        if (!overlay.isConnected) {
          overlay.className = 'dx-transition'
          overlay.setAttribute('aria-hidden', 'true')
          const veil = document.createElement('div')
          veil.className = 'dx-veil'
          overlay.append(veil)
          document.documentElement.append(overlay)
        }
        artwork = document.createElement('div')
        artwork.className = 'dx-geometry'
        overlay.append(artwork)
      }
      if (overlay) overlay.dataset.phase = value
      emit()
    },
    async frame(signal) {
      const assetAbort = new AbortController(),
        cancel = () => assetAbort.abort()
      signal.addEventListener('abort', cancel, { once: true })
      ownedListeners++
      emit()
      const budget = setTimer(cancel, 1800)
      try {
        await visual.prepare(assetAbort.signal)
      } finally {
        clearTimer(budget)
        assetAbort.abort()
        signal.removeEventListener('abort', cancel)
        ownedListeners--
        emit()
      }
      await new Promise<void>((resolve, reject) => {
        let frame = 0,
          settled = false
        const cleanup = () => {
          cancelAnimationFrame(frame)
          clearTimer(fallback)
          signal.removeEventListener('abort', cancel)
          frameCount--
          ownedListeners--
          emit()
        }
        const finish = () => {
          if (settled) return
          settled = true
          cleanup()
          resolve()
        }
        const cancel = () => {
          if (settled) return
          settled = true
          cleanup()
          reject(signal.reason)
        }
        const fallback = setTimer(finish, 100)
        frameCount++
        ownedListeners++
        emit()
        signal.addEventListener('abort', cancel, { once: true })
        frame = requestAnimationFrame(finish)
        if (signal.aborted) cancel()
      })
    },
    async animate(stage, signal) {
      const marker = visual.draw(stage)
      if (!marker) return
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const cleanup = () => {
          marker.element.removeEventListener('animationend', ended)
          marker.element.removeEventListener('animationcancel', ended)
          marker.animation.removeEventListener('finish', finish)
          signal.removeEventListener('abort', cancel)
          clearTimer(fallback)
          ownedListeners -= 4
          emit()
        }
        const finish = () => {
          if (settled) return
          settled = true
          cleanup()
          resolve()
        }
        const cancel = () => {
          if (settled) return
          settled = true
          cleanup()
          reject(signal.reason)
        }
        const ended = (event: Event) => {
          if (
            event.target === marker.element &&
            (event as AnimationEvent).animationName === marker.name
          )
            finish()
        }
        const fallback = setTimer(finish, 2400)
        ownedListeners += 4
        emit()
        marker.element.addEventListener('animationend', ended)
        marker.element.addEventListener('animationcancel', ended)
        marker.animation.addEventListener('finish', finish)
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
      })
    },
  })
  const cancel = () => controller.cancel()
  const hidden = () => {
    if (document.hidden) cancel()
  }
  const reduced = () => {
    if (systemReduced.matches) cancel()
  }
  document.addEventListener('visibilitychange', hidden)
  window.addEventListener('pagehide', cancel)
  systemReduced.addEventListener('change', reduced)
  ownedListeners += 3
  const done = controller
    .start(() => readiness)
    .finally(() => {
      applicationReady()
      visual.dispose()
      overlay?.remove()
      target.__NOZOKI_DX_CURTAIN__?.cancel()
      overlay = undefined
      artwork = undefined
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', cancel)
      systemReduced.removeEventListener('change', reduced)
      ownedListeners -= 3
      for (const id of timers) clearTimeout(id)
      timers.clear()
      emit()
      listeners.clear()
    })
  target.__NOZOKI_DX_BOOT__ = {
    done,
    snapshot,
    ready() {
      applicationReady()
      // The prepaint curtain already covers SSR: readiness ends holding, never skips the reveal.
    },
    cancel,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
  }
}
