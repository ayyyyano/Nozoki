<script setup lang="ts">
import type { DataSnapshot, DeepSeekData } from '../../../shared/contracts/dashboard'
import { decimalText } from '../../../shared/domain/format'
const props = defineProps<{ snapshot: DataSnapshot<DeepSeekData>; title: string }>()
const spend = computed(() => {
  const records = props.snapshot.data?.spend ?? []
  return records.filter((record) => record.currency === records[0]?.currency).slice(-14)
})
const maxSpend = computed(() => Math.max(...spend.value.map((d) => Number(d.amount)), 1))
</script>
<template>
  <DashboardModuleCard
    id="deepseek"
    :title="title"
    icon="spark"
    :status="snapshot.status"
    :observed-at="snapshot.observedAt"
  >
    <div v-if="snapshot.data?.balances.length" class="metric-caption">账户余额</div>
    <div v-if="snapshot.data?.balances.length" class="balance-list">
      <div v-for="balance in snapshot.data.balances" :key="balance.currency" class="balance-row">
        <strong class="metric-value">{{ decimalText(balance.total) }}</strong
        ><span class="unit">{{ balance.currency }}</span>
      </div>
    </div>
    <DashboardDataState
      :status="snapshot.status"
      :empty="!snapshot.data?.balances.length"
      :last-success-at="snapshot.lastSuccessAt"
      compact
    />
    <div v-if="spend.length" class="section-heading">
      <h3>消费趋势</h3>
      <span>{{ spend.length ? spend[0]?.currency : '无消费记录' }}</span>
    </div>
    <div
      v-if="spend.length"
      class="spend-bars"
      role="img"
      aria-label="消费记录，各柱只比较同一币种"
    >
      <div
        v-for="(day, index) in spend"
        :key="index"
        class="spend-bar"
        :title="`${day.day} · ${day.currency} ${day.amount}`"
      >
        <i :style="{ height: `${(Number(day.amount) / maxSpend) * 100}%` }" /><small>{{
          day.day.slice(5)
        }}</small>
      </div>
    </div>
    <p v-else-if="snapshot.data?.balances.length" class="scope-note">消费来源未提供记录</p>
  </DashboardModuleCard>
</template>
