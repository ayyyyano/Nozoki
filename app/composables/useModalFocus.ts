const stack: symbol[] = []
let restoreBackground: (() => void) | undefined

/** Includes Varlet Select menus teleported to body; does not make them inert. */
export function useModalFocus(show: Ref<boolean>, panel: Ref<HTMLElement | null>) {
  const modal = Symbol()
  const isTop = () => stack.at(-1) === modal
  let previous: HTMLElement | null = null
  let stop: (() => void) | undefined
  const candidates = () =>
    [
      ...(panel.value?.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, a[href], [tabindex="0"]',
      ) ?? []),
      ...document.querySelectorAll<HTMLElement>('.var-menu__menu [tabindex="0"]'),
    ].filter((el) => el.getClientRects().length && !el.matches(':disabled'))
  function trap(event: KeyboardEvent) {
    if (!isTop() || event.key !== 'Tab') return
    const items = candidates()
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (!items.length) {
      event.preventDefault()
      panel.value?.focus()
      return
    }
    if (event.shiftKey && index <= 0) {
      event.preventDefault()
      items.at(-1)?.focus()
    } else if (!event.shiftKey && (index === items.length - 1 || index < 0)) {
      event.preventDefault()
      items[0]?.focus()
    }
  }
  function constrain(event: FocusEvent) {
    if (!isTop()) return
    const target = event.target as HTMLElement
    if (!panel.value?.contains(target) && !target.closest('.var-menu__menu'))
      candidates()[0]?.focus()
  }
  async function activate() {
    if (stop) return
    previous = document.activeElement as HTMLElement
    await nextTick()
    if (!show.value || !panel.value || stop) return
    const first = !stack.length
    stack.push(modal)
    document.addEventListener('keydown', trap)
    document.addEventListener('focusin', constrain)
    ;(candidates()[0] ?? panel.value)?.focus()
    if (first) {
      const background = [
        ...document.querySelectorAll<HTMLElement>('#main-content, .page-actions, .fixture-preview'),
      ].filter((el) => !el.contains(panel.value))
      const old = background.map((el) => ({
        inert: el.inert,
        hidden: el.getAttribute('aria-hidden'),
      }))
      background.forEach((el) => {
        el.inert = true
        el.setAttribute('aria-hidden', 'true')
      })
      restoreBackground = () => {
        background.forEach((el, index) => {
          el.inert = old[index]!.inert
          const hidden = old[index]!.hidden
          if (hidden === null) el.removeAttribute('aria-hidden')
          else el.setAttribute('aria-hidden', hidden)
        })
      }
    }
    stop = () => {
      document.removeEventListener('keydown', trap)
      document.removeEventListener('focusin', constrain)
      stack.splice(stack.indexOf(modal), 1)
      if (!stack.length) {
        restoreBackground?.()
        restoreBackground = undefined
      }
      stop = undefined
    }
  }
  watch(show, (open) => (open ? activate() : stop?.()))
  onMounted(() => {
    if (show.value) void activate()
  })
  onBeforeUnmount(() => {
    stop?.()
    previous?.focus()
  })
  return {
    restoreFocus: () => {
      if (!show.value) previous?.focus()
    },
  }
}
