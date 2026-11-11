<script setup lang="ts">
import { dashboardPlan } from '../../../shared/domain/module-layout'
const props = defineProps<{ businessCount: number; linksVisible: boolean }>()
const medium = computed(() => dashboardPlan(props.businessCount, 2, props.linksVisible))
const wide = computed(() => dashboardPlan(props.businessCount, 3, props.linksVisible))
const compactWide = computed(() =>
  dashboardPlan(props.businessCount, 3, props.linksVisible, 'strip-single-tail'),
)
const expanded = computed(() => dashboardPlan(props.businessCount, 4, props.linksVisible))
function businessStyle(index: number) {
  return {
    '--medium-span': medium.value.businessSpans[index] ?? 12,
    '--compact-wide-span': compactWide.value.businessSpans[index] ?? 12,
    '--wide-span': wide.value.businessSpans[index] ?? 12,
    '--expanded-span': expanded.value.businessSpans[index] ?? 12,
  }
}
</script>
<template>
  <div class="dashboard-grid-container">
    <div
      class="dashboard-grid"
      :data-business-count="businessCount"
      :data-multiple-rows="businessCount >= 4"
      :data-medium-links="medium.links"
      :data-wide-links="wide.links"
      :data-compact-wide-links="compactWide.links"
      :data-expanded-links="expanded.links"
      :style="{
        '--medium-columns': medium.columns,
        '--wide-columns': wide.columns,
        '--compact-wide-columns': compactWide.columns,
        '--expanded-columns': expanded.columns,
        '--medium-links-span': medium.linksSpan,
        '--compact-wide-links-span': compactWide.linksSpan,
        '--wide-links-span': wide.linksSpan,
        '--expanded-links-span': expanded.linksSpan,
      }"
    >
      <slot :business-style="businessStyle" />
    </div>
  </div>
</template>
