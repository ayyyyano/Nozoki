/** Includes Varlet Select menus teleported to body; does not make them inert. */
export function useModalFocus(show: Ref<boolean>, panel: Ref<HTMLElement | null>) {
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
    if (event.key !== 'Tab') return
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
    const target = event.target as HTMLElement
    if (!panel.value?.contains(target) && !target.closest('.var-menu__menu'))
      candidates()[0]?.focus()
  }
  watch(show, async (open) => {
    stop?.()
    if (!open) {
      return
    }
    previous = document.activeElement as HTMLElement
    await nextTick()
    if (!show.value) return
    const background = [
      ...document.querySelectorAll<HTMLElement>('#main-content, .page-actions, .fixture-preview'),
    ]
    const old = background.map((el) => el.inert)
    background.forEach((el) => {
      el.inert = true
    })
    document.addEventListener('keydown', trap)
    document.addEventListener('focusin', constrain)
    candidates()[0]?.focus()
    stop = () => {
      document.removeEventListener('keydown', trap)
      document.removeEventListener('focusin', constrain)
      background.forEach((el, index) => {
        el.inert = old[index]!
      })
      stop = undefined
    }
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
