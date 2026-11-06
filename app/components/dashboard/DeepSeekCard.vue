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
        <div class="section-heading"><h3>近 7 日剩余余额</h3></div>
        <div class="balance-bars"><i v-for="n in 7" :key="n" /></div>
      </div>
      <span class="balance-private-label">登录后查看余额</span>
    </div>
    <template v-else>
      <DashboardDataState
        :configured="snapshot.sourceConfigured"
        :error-code="snapshot.errorCode"
        :status="snapshot.status"
        :empty="!snapshot.data?.balances.length && !snapshot.data?.dailyBalances.length"
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
            <span
              v-if="day.point"
              class="balance-bar-value"
              :style="{ transform: `translateY(${76 - Math.max(3, day.height * 0.76)}px)` }"
              >{{ decimalText(day.point.total) }}</span
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
    </template>
    <template v-if="!snapshot.data?.masked && snapshot.collectedAt" #footer>
      采集于
      <time :datetime="snapshot.collectedAt">{{
        formatTimestamp(snapshot.collectedAt, timezone)
      }}</time>
    </template>
  </DashboardModuleCard>
</template>
