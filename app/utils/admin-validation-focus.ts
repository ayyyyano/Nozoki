export function focusAdminValidation(scope?: HTMLElement | null, field?: string) {
  if (!scope) return false
  const controls =
    'input:not(:disabled):not([readonly]), textarea:not(:disabled):not([readonly]), select:not(:disabled), [role="combobox"][tabindex="0"]'
  const fieldGroup =
    field && scope.querySelector<HTMLElement>(`[data-error-field="${CSS.escape(field)}"]`)
  const firstVisible = (root: HTMLElement) =>
    [root, ...root.querySelectorAll<HTMLElement>(controls)].find(
      (element) => element.matches(controls) && element.getClientRects().length,
    )
  const input = (fieldGroup && firstVisible(fieldGroup)) || firstVisible(scope)
  if (!input) return false
  input.focus()
  const highlight = input.closest('.var-input, .var-select') ?? input
  highlight.removeAttribute('data-validation-target')
  highlight.getBoundingClientRect()
  highlight.setAttribute('data-validation-target', '')
  input.addEventListener('blur', () => highlight.removeAttribute('data-validation-target'), {
    once: true,
  })
  return true
}
