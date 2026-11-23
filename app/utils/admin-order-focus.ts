import { nextTick } from 'vue'

export async function preserveAdminOrderFocus(event: Event, move: () => void) {
  const button = event.currentTarget
  const wasFocused = button instanceof HTMLButtonElement && document.activeElement === button
  move()
  if (!wasFocused) return
  await nextTick()
  if (
    !button.isConnected ||
    (document.activeElement !== document.body && document.activeElement !== button)
  )
    return
  const target = button.disabled
    ? button.closest('li')?.querySelector<HTMLElement>('[data-order-edit]')
    : button
  target?.focus({ preventScroll: true })
}
