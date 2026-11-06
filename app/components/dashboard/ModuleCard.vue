<script setup lang="ts">
import type { DataStatus, ModuleId } from '../../../shared/contracts/dashboard'
import { MODULE_ICONS } from '../../../shared/icons/modules'
import { formatTimestamp } from '../../../shared/domain/format'
const timezone = useDashboardTimezone()
defineProps<{
  id: ModuleId
  title: string
  status: DataStatus
  observedAt?: string | null
}>()
</script>
<template>
  <section
    class="module-card"
    data-layout-flexible="surface"
    :data-module="id"
    :data-status="status"
    :aria-labelledby="`heading-${id}`"
  >
    <header class="module-header">
      <span class="module-icon"><CommonAppIcon :name="MODULE_ICONS[id]" /></span>
      <h2 :id="`heading-${id}`">{{ title }}</h2>
    </header>
    <div class="module-body"><slot /></div>
    <footer v-if="observedAt" class="sync-time">
      观测于 <time :datetime="observedAt">{{ formatTimestamp(observedAt, timezone) }}</time>
    </footer>
  </section>
</template>
