// Visuals are vendored from the user-selected reference. Only lifecycle/timing is adapted here.
const assetRoot = '/vendor/maimai-transition/'
const player = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${assetRoot}upstream.css">
<link rel="stylesheet" href="${assetRoot}player.css">
<div class="stage"><div class="frame"></div></div>`

export function createMaimaiVisual(
  host: () => HTMLElement | null,
  onFrames: (count: number) => void = () => {},
) {
  let animations: CSSAnimation[] = []
  let frameId = 0
  let pendingFrames = 0
  const setFrames = (count: number) => {
    pendingFrames = count
    onFrames(count)
  }
  let layers: {
    target: HTMLElement | SVGElement
    name: string
    delay: number
    duration: number
  }[] = []
  let stage: HTMLElement | undefined
  let loaded = false
  function dispose() {
    for (const animation of animations) animation.cancel()
    cancelAnimationFrame(frameId)
    frameId = 0
    setFrames(0)
    animations = []
    layers = []
    stage = undefined
    host()?.replaceChildren()
    loaded = false
  }
  async function prepare(signal: AbortSignal) {
    const container = host()
    if (!container || signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    const iframe = document.createElement('iframe')
    iframe.title = '加载过渡'
    iframe.tabIndex = -1
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('sandbox', 'allow-same-origin')
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;pointer-events:none;'
    const frameReady = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        iframe.removeEventListener('load', finish)
        signal.removeEventListener('abort', cancel)
      }
      const cancel = () => {
        cleanup()
        reject(signal.reason)
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      iframe.addEventListener('load', finish, { once: true })
      signal.addEventListener('abort', cancel, { once: true })
    })
    iframe.srcdoc = player
    container.append(iframe)
    const artwork = fetch(`${assetRoot}transition.svg`, { signal }).then((response) => {
      if (!response.ok) throw new Error(`Transition artwork HTTP ${response.status}`)
      return response.text()
    })
    const [, markup] = await Promise.all([frameReady, artwork])
    signal.throwIfAborted()
    stage = iframe.contentDocument?.querySelector<HTMLElement>('.stage') ?? undefined
    const frame = stage?.querySelector('.frame')
    if (!stage || !frame) throw new Error('Transition frame unavailable')
    frame.innerHTML = markup
    const svg = frame.querySelector('svg')
    if (!svg) throw new Error('Transition artwork unavailable')
    const chip = svg.querySelector('#滴拉熊')
    if (chip) svg.append(chip)
    animations = stage
      .getAnimations({ subtree: true })
      .filter((a): a is CSSAnimation => 'animationName' in a)
    if (!animations.length) throw new Error('Reference animations unavailable')
    for (const animation of animations) {
      const target = (animation.effect as KeyframeEffect).target as HTMLElement | SVGElement
      const timing = animation.effect!.getTiming()
      layers.push({
        target,
        name: animation.animationName,
        delay: timing.delay ?? 0,
        duration: Number(timing.duration),
      })
    }
    for (const animation of animations) {
      animation.pause()
      animation.currentTime = 0
    }
    loaded = true
  }
  function draw(phase: 'entering' | 'leaving') {
    if (!loaded) return
    const leaving = phase === 'leaving'
    const selected = layers.filter(
      (a) => (a.name.includes('-out') || a.name.startsWith('expand-')) === leaving,
    )
    const timings = selected
    const offset = Math.min(...timings.map((t) => t.delay))
    const end = Math.max(...timings.map((t) => t.delay + Number(t.duration)))
    const duration = leaving ? 320 : 240
    const last = selected.findLast(
      (_, index) => Math.abs(timings[index]!.delay + timings[index]!.duration - end) < 0.01,
    )!
    const marker = animations.find(
      (animation) =>
        animation.animationName === last.name &&
        (animation.effect as KeyframeEffect).target === last.target,
    )!
    const driven = selected.map((layer) => ({
      layer,
      animation: animations.find(
        (a) =>
          a.animationName === layer.name && (a.effect as KeyframeEffect).target === layer.target,
      )!,
    }))
    cancelAnimationFrame(frameId)
    const started = performance.now()
    // Follow the reference scroll player's paused-currentTime technique. Only the clock differs.
    const tick = (now: number) => {
      setFrames(0)
      const progress = Math.max(0, Math.min(1, (now - started) / duration))
      const time = offset + (end - offset) * progress
      for (const { layer, animation } of driven)
        animation.currentTime = Math.min(time, layer.delay + layer.duration)
      if (progress < 1) {
        setFrames(1)
        frameId = requestAnimationFrame(tick)
      } else {
        frameId = 0
        marker.finish()
      }
    }
    setFrames(1)
    frameId = requestAnimationFrame(tick)
    return {
      element: last.target,
      name: last.name,
      animation: marker,
    }
  }
  return {
    prepare,
    draw,
    dispose,
    get pendingFrames() {
      return pendingFrames
    },
  }
}
