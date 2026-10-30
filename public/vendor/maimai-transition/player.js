/* Nozoki lifecycle bridge; artwork/keyframes: gfdfdxc/maimai-transition, see NOTICE.txt. */
;(async () => {
  try {
    const response = await fetch('transition.svg')
    if (!response.ok) throw new Error('SVG ' + response.status)
    const frame = document.querySelector('.frame')
    frame.innerHTML = await response.text()
    const svg = frame.querySelector('svg'),
      chip = svg.querySelector('#滴拉熊')
    if (chip) svg.append(chip)
    for (const animation of frame.getAnimations({ subtree: true })) animation.pause()
    parent.postMessage({ type: 'nozoki-maimai-ready' }, location.origin)
  } catch (error) {
    parent.postMessage({ type: 'nozoki-maimai-error' }, location.origin)
  }
})()
