<script setup lang="ts">
import { dashboardPlan } from '../../../shared/domain/module-layout'
const props = defineProps<{ businessCount: number; linksVisible: boolean }>()
const medium = computed(() => dashboardPlan(props.businessCount, 2, props.linksVisible))
const wide = computed(() => dashboardPlan(props.businessCount, 3, props.linksVisible))
const expanded = computed(() => dashboardPlan(props.businessCount, 4, props.linksVisible))
</script>
<template>
  <div class="dashboard-grid-container">
    <div
      class="dashboard-grid"
      :data-business-count="businessCount"
      :data-multiple-rows="businessCount >= 4"
      :data-medium-links="medium.links"
      :data-wide-links="wide.links"
      :data-expanded-links="expanded.links"
      :style="{
        '--medium-columns': medium.columns,
        '--wide-columns': wide.columns,
        '--expanded-columns': expanded.columns,
      }"
    >
      <slot />
    </div>
  </div>
</template>
