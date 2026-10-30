import type { DxBootWindow } from './dx-boot'

/** Synchronous head prepaint. The async reference player adopts this existing solid cover. */
export function armDxCurtain() {
  const target = window as DxBootWindow
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  if (
    target.__NOZOKI_DX_CURTAIN__ ||
    target.__NOZOKI_DX_BOOT__ ||
    target.__NOZOKI_DX_APP_MOUNTED__ ||
    document.hidden ||
    reduced.matches ||
    document.documentElement.dataset.nozokiReduced === 'true'
  )
    return
  const element = document.createElement('div')
  element.className = 'dx-transition'
  element.dataset.phase = 'boot'
  element.setAttribute('aria-hidden', 'true')
  const veil = document.createElement('div')
  veil.className = 'dx-veil'
  element.append(veil)
  // Keep the portal outside Nuxt's root and body Teleport hydration anchors.
  document.documentElement.append(element)
  let claimed = false
  const cleanup = () => {
    clearTimeout(budget)
    window.removeEventListener('pagehide', cancel)
    document.removeEventListener('visibilitychange', visibility)
    reduced.removeEventListener('change', motion)
  }
  const cancel = () => {
    cleanup()
    if (!claimed) element.remove()
  }
  const visibility = () => {
    if (document.hidden) cancel()
  }
  const motion = () => {
    if (reduced.matches) cancel()
  }
  // Independent fail-open budget: even an unavailable async bootstrap cannot leave a cover.
  const budget = setTimeout(cancel, 12000)
  window.addEventListener('pagehide', cancel)
  document.addEventListener('visibilitychange', visibility)
  reduced.addEventListener('change', motion)
  target.__NOZOKI_DX_CURTAIN__ = {
    element,
    claim() {
      cleanup()
      if (claimed || !element.isConnected) return null
      claimed = true
      return element
    },
    cancel,
  }
}
