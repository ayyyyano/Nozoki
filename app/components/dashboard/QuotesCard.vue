<script setup lang="ts">
import type { DataSnapshot, QuotesData } from '../../../shared/contracts/dashboard'
import { formatTimestamp } from '../../../shared/domain/format'
import { HOME_LIMITS, quoteHasDetails, quoteUpdates } from '../../../shared/domain/home-summary'
import { additionalSuccess } from '../../../shared/domain/summary-status'
const props = defineProps<{ snapshot: DataSnapshot<QuotesData>; title: string }>()
const timezone = useDashboardTimezone()
const items = computed(() => props.snapshot.data?.items ?? [])
const home = computed(() => items.value.slice(0, HOME_LIMITS.quotes))
const updates = computed(() => quoteUpdates(home.value, props.snapshot.observedAt))
const detailUpdates = computed(() => quoteUpdates(items.value, props.snapshot.observedAt))
</script>
<template>
  <DashboardModuleCard
    id="quotes"
    :title="title"
    :status="snapshot.status"
    :has-data="!!items.length"
    :details="items.length > HOME_LIMITS.quotes || quoteHasDetails(items)"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="!!items.length"
      :empty="!items.length"
      compact
    />
    <DashboardQuoteList :items="home" />
    <template #details>
      <DashboardDataState :status="snapshot.status" :empty="!items.length" compact />
      <DashboardQuoteList :items="items" detail />
      <p class="sync-time" v-for="(update, index) in detailUpdates" :key="index">
        {{ update.symbol }} {{ update.label }} {{ formatTimestamp(update.at, timezone) }}
      </p>
    </template>
    <template v-if="updates.length" #footer>
      <p v-for="(update, index) in updates" :key="index">
        <span v-if="update.symbol">{{ update.symbol }} · </span
        ><DashboardSummaryTime v-if="update.at" :value="update.at" :label="update.label" /><span
          v-else
          >报价时间未知</span
        >
        <span v-if="update.delayedMinutes !== null"> · 延迟 {{ update.delayedMinutes }} 分钟</span>
      </p>
      <span
        v-if="
          snapshot.status === 'error' &&
          additionalSuccess(
            snapshot.status,
            snapshot.lastSuccessAt,
            updates.length === 1 ? updates[0]?.at : null,
          )
        "
        class="summary-extra-time"
        ><DashboardSummaryTime :value="snapshot.lastSuccessAt!" label="最近成功"
      /></span>
    </template>
  </DashboardModuleCard>
</template>
