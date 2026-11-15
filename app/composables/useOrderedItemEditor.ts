export function useOrderedItemEditor<T extends object>(items: Ref<T[]>) {
  const index = ref<number | null>(null)
  const draft = shallowRef<T>()
  const show = ref(false)

  function open(value: T, selected: number | null = null) {
    index.value = selected
    draft.value = reactive({ ...value }) as T
    show.value = true
  }

  function edit(selected: number) {
    const value = items.value[selected]
    if (value) open(value, selected)
  }

  function apply() {
    if (!draft.value) return
    if (index.value === null) items.value.push(draft.value)
    else if (items.value[index.value]) Object.assign(items.value[index.value]!, draft.value)
    show.value = false
  }

  function remove() {
    if (index.value !== null) items.value.splice(index.value, 1)
    show.value = false
  }

  return { index, draft, show, open, edit, apply, remove }
}
