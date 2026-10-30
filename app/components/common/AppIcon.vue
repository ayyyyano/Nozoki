<script setup lang="ts">
import { coreIcons } from '../../icons/core'
import { materialIconName } from '../../../shared/icons/material'
const props = withDefaults(defineProps<{ name: string; size?: number; filled?: boolean }>(), {
  size: 24,
  filled: false,
})
const canonical = computed(() => materialIconName(props.name))
const core = computed(() =>
  Object.hasOwn(coreIcons, props.name)
    ? coreIcons[props.name]
    : Object.values(coreIcons).find((icon) => icon.name === canonical.value),
)
const component = computed(() =>
  core.value
    ? props.filled && core.value.filled
      ? core.value.filled
      : core.value.component
    : coreIcons.spark!.component,
)
const custom = computed(() => {
  if (!import.meta.client || !canonical.value || core.value) return undefined
  const name = canonical.value
  return defineAsyncComponent({
    loader: async () => {
      const { loadMaterialIcon } = await import('../../icons/material-loader.client')
      return loadMaterialIcon(name)
    },
    errorComponent: coreIcons.spark!.component,
    timeout: 15000,
  })
})
const attrs = computed(() => ({
  width: props.size,
  height: props.size,
  fill: 'currentColor',
  'aria-hidden': 'true',
  focusable: 'false',
  class: 'app-icon',
  'data-symbol': core.value?.symbol ?? canonical.value ?? 'auto_awesome',
  'data-fill': props.filled ? 1 : 0,
}))
</script>
<template>
  <component :is="component" v-if="core || !canonical" v-bind="attrs" />
  <ClientOnly v-else>
    <component :is="custom" v-bind="attrs" />
    <template #fallback
      ><span
        class="app-icon"
        aria-hidden="true"
        :style="{
          display: 'inline-block',
          width: `${size}px`,
          height: `${size}px`,
          flexShrink: 0,
        }"
    /></template>
  </ClientOnly>
</template>
