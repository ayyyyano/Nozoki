<script setup lang="ts">
import { formatTimestamp } from '../../../shared/domain/format'
const props = defineProps<{ value: string; label: string; timezone?: string }>()
const siteTimezone = useDashboardTimezone()
const zone = computed(() => props.timezone ?? siteTimezone.value)
</script>
<template>
  <span class="summary-time"
    >{{ label }}
    <time :datetime="value" :title="formatTimestamp(value, zone)">{{
      formatTimestamp(value, zone).slice(5)
    }}</time></span
  >
</template>
