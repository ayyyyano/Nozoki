<script setup lang="ts">
import type { DataSnapshot, DeepSeekData } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp } from '../../../shared/domain/format'
import { balanceDays } from '../../../shared/domain/daily-balances'
const props = defineProps<{ snapshot: DataSnapshot<DeepSeekData>; title: string }>()
const clock = useLocalClock()
const siteTimezone = useDashboardTimezone()
const timezone = computed(() => props.snapshot.data?.timezone ?? siteTimezone.value)
const days = computed(() => balanceDays(clock.value, timezone.value))
const series = computed(() => {
  const data = props.snapshot.data
  const currencies = [
    ...new Set([
      ...(data?.balances ?? []).map((b) => b.currency),
      ...(data?.dailyBalances ?? []).map((b) => b.currency),
    ]),
  ].filter((v) => /^[A-Z]{3}$/.test(v))
  return currencies.map((currency) => {
    const records = days.value.map(({ day }) => {
      const point = data?.dailyBalances.find((b) => b.day === day && b.currency === currency)
      const valid =
        point && typeof point.total === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(point.total)
      return { day, point: valid ? point : null }
    })
    const max = Math.max(...records.map(({ point }) => Math.abs(Number(point?.total ?? 0))), 0)
    return {
      currency,
      records: records.map((r) => ({
        ...r,
        height: r.point && max ? (Math.abs(Number(r.point.total)) / max) * 100 : 0,
      })),
    }
  })
})
</script>
<template>
  <DashboardModuleCard id="deepseek" :title="title" :status="snapshot.status">
    <div v-if="snapshot.data?.masked" class="balance-private" role="status">
      <div class="balance-private-preview" aria-hidden="true">
        <div class="metric-caption">账户余额</div>
        <strong class="metric-value">••••</strong>
        <div class="balance-bars"><i v-for="n in 7" :key="n" /></div>
      </div>
      <span class="balance-private-label">登录后查看余额</span>
    </div>
    <template v-else>
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
      <figure v-for="s in series" :key="s.currency" class="balance-history">
        <figcaption class="section-heading">
          <h3>近 7 日剩余余额</h3>
          <span>{{ s.currency }}</span>
        </figcaption>
        <div class="balance-bars">
          <div
            v-for="(day, index) in s.records"
            :key="day.day"
            class="balance-bar"
            :class="{ 'balance-bar-missing': !day.point }"
            tabindex="0"
            :title="
              day.point
                ? `${day.day} · ${decimalText(day.point.total)} ${s.currency} · 采集于 ${formatTimestamp(day.point.collectedAt, timezone)}`
                : `${day.day} · 尚无记录`
            "
            :aria-label="
              day.point
                ? `${day.day} 剩余 ${decimalText(day.point.total)} ${s.currency}，${index === 6 ? '今日最新观测' : '当日最后观测'}，采集于 ${formatTimestamp(day.point.collectedAt, timezone)}`
                : `${day.day} 尚无记录`
            "
          >
            <div class="balance-bar-track">
              <i
                v-if="day.point"
                :class="{ 'balance-negative': day.point.total.startsWith('-') }"
                :style="{ height: `${day.height}%` }"
              /><span v-else>—</span>
            </div>
            <small>{{ index === 6 ? '今日' : day.day.slice(5) }}</small>
          </div>
        </div>
      </figure>
      <p v-if="series.length" class="scope-note">
        今日随采集更新；历史为当日最后一次成功观测 · {{ timezone }}
      </p>
      <p v-if="snapshot.collectedAt" class="scope-note">
        采集于 {{ formatTimestamp(snapshot.collectedAt, timezone) }}
      </p>
    </template>
  </DashboardModuleCard>
</template>
