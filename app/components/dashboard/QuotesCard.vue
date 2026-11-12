<script setup lang="ts">
import type { DataSnapshot, QuotesData } from '../../../shared/contracts/dashboard'
import { HOME_LIMITS, quoteHasDetails, quoteUpdates } from '../../../shared/domain/home-summary'
const props = defineProps<{ snapshot: DataSnapshot<QuotesData>; title: string }>()
const items = computed(() => props.snapshot.data?.items ?? [])
const home = computed(() => items.value.slice(0, HOME_LIMITS.quotes))
const updates = computed(() => quoteUpdates(items.value, props.snapshot.observedAt))
</script>
<template>
  <DashboardModuleCard
    id="quotes"
    :title="title"
    :status="snapshot.status"
    :has-data="!!items.length"
    :observed-at="updates.length === 1 ? updates[0]?.at : null"
    :last-success-at="snapshot.status === 'error' ? snapshot.lastSuccessAt : null"
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
    </template>
    <template v-if="updates.length" #subtitle>
      <p v-for="(update, index) in updates" :key="index">
        <span v-if="update.symbol">{{ update.symbol }} · </span
        ><DashboardSummaryTime v-if="update.at" :value="update.at" :label="update.label" /><span
          v-else
          >报价时间未知</span
        >
        <span v-if="update.delayedMinutes !== null"> · 延迟 {{ update.delayedMinutes }} 分钟</span>
      </p>
    </template>
  </DashboardModuleCard>
</template>
