<script setup lang="ts">
import type { DataStatus, ModuleId } from '../../../shared/contracts/dashboard'
import { MODULE_ICONS } from '../../../shared/icons/modules'
import { moduleRole } from '../../../shared/domain/module-layout'
import { summaryStatus, additionalSuccess } from '../../../shared/domain/summary-status'
const open = ref(false)
const tooltip = ref(false)
function openDetails() {
  tooltip.value = false
  open.value = true
}
defineProps<{
  id: ModuleId
  title: string
  status: DataStatus
  observedAt?: string | null
  details?: boolean
  hasData?: boolean
  timeLabel?: string
  lastSuccessAt?: string | null
}>()
</script>
<template>
  <section
    class="module-card"
    :data-layout-role="moduleRole(id)"
    :data-module="id"
    :data-status="status"
    :aria-labelledby="`heading-${id}`"
  >
    <header class="module-header">
      <span class="module-icon"><CommonAppIcon :name="MODULE_ICONS[id]" /></span>
      <h2 :id="`heading-${id}`">{{ title }}</h2>
      <span
        v-if="hasData && summaryStatus(status)"
        class="summary-status"
        :data-status="status"
        role="status"
        >{{ summaryStatus(status) }}</span
      >
      <VarTooltip
        v-if="details && $slots.details"
        v-model:show="tooltip"
        :disabled="open"
        :content="`查看${title}详情`"
      >
        <VarButton
          text
          round
          class="module-detail-button"
          :aria-label="`查看${title}详情`"
          :title="`查看${title}详情`"
          aria-haspopup="dialog"
          @focus="tooltip = true"
          @blur="tooltip = false"
          @click="openDetails"
          ><CommonAppIcon name="OpenInFullRound" :size="20"
        /></VarButton>
      </VarTooltip>
    </header>
    <div class="module-body"><slot /></div>
    <footer
      v-if="
        observedAt ||
        $slots.footer ||
        (hasData && additionalSuccess(status, lastSuccessAt, observedAt))
      "
      class="sync-time"
    >
      <slot name="footer">
        <DashboardSummaryTime
          v-if="observedAt"
          :value="observedAt"
          :label="timeLabel ?? '观测于'"
        />
        <span
          v-if="hasData && additionalSuccess(status, lastSuccessAt, observedAt)"
          class="summary-extra-time"
          ><DashboardSummaryTime :value="lastSuccessAt!" label="最近成功"
        /></span>
      </slot>
    </footer>
    <DashboardModuleDetail
      v-if="details && $slots.details"
      v-model:show="open"
      :title="title + '详情'"
    >
      <slot name="details" />
    </DashboardModuleDetail>
  </section>
</template>
