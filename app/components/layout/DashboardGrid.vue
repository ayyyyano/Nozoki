<script setup lang="ts">
import { observeNaturalGrid } from '../../utils/natural-grid'

const grid = useTemplateRef<HTMLElement>('grid')
let dispose: (() => void) | undefined
onMounted(() => {
  if (grid.value) dispose = observeNaturalGrid(grid.value)
})
onBeforeUnmount(() => dispose?.())
</script>
<template>
  <div class="dashboard-grid-container">
    <div ref="grid" class="dashboard-grid"><slot /></div>
  </div>
</template>
