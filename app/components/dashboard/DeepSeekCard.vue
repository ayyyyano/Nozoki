<script setup lang="ts">
import type { DataSnapshot, DeepSeekData } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp } from '../../../shared/domain/format'
import { decimalPoint } from '../../../shared/domain/chart-series'
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
  return currencies.map((currency) => ({
    currency,
    points: days.value.map(({ day }, index) => {
      const point = data?.dailyBalances.find((b) => b.day === day && b.currency === currency)
      return {
        ...decimalPoint(day, index === 6 ? '今日' : day.slice(5), point?.total, currency),
        detail: point
          ? `${index === 6 ? '今日最新观测' : '当日最后观测'} · 采集于 ${formatTimestamp(point.collectedAt, timezone.value)}`
          : undefined,
      }
    }),
  }))
})
const selectedCurrency = ref<string>()
const detailSeries = computed(
  () => series.value.find((s) => s.currency === selectedCurrency.value) ?? series.value[0],
)
</script>
<template>
  <DashboardModuleCard
    id="deepseek"
    :title="title"
    :status="snapshot.status"
    :has-data="!!series.length || !!snapshot.data?.masked"
    :observed-at="snapshot.data?.masked ? null : snapshot.collectedAt"
    :last-success-at="snapshot.data?.masked ? null : snapshot.lastSuccessAt"
    time-label="采集于"
    :time-zone="timezone"
    :details="
      !snapshot.data?.masked &&
      !!snapshot.data &&
      (series.length > 1 ||
        snapshot.data.balances.some((b) => b.toppedUp !== null || b.granted !== null) ||
        snapshot.data.dailyBalances.length > 0)
    "
  >
    <template v-if="!snapshot.data?.masked" #details="{ open }">
      <DashboardDataState :status="snapshot.status" compact />
      <section v-if="detailSeries && open" class="detail-chart">
        <h3>近 7 日剩余余额 · {{ detailSeries.currency }}</h3>
        <div v-if="series.length > 1" class="chart-choices" aria-label="余额币种">
          <button
            v-for="item in series"
            :key="item.currency"
            type="button"
            :aria-pressed="item.currency === detailSeries.currency"
            @click="selectedCurrency = item.currency"
          >
            {{ item.currency }}
          </button>
        </div>
        <ChartsTimeSeriesChart
          :key="detailSeries.currency"
          type="bar"
          :label="`近 7 日 ${detailSeries.currency} 余额`"
          :points="detailSeries.points"
        />
      </section>
      <section v-for="balance in snapshot.data?.balances ?? []" :key="balance.currency">
        <h3>{{ balance.currency }} 余额组成</h3>
        <dl class="quote-details">
          <div v-if="balance.total !== null">
            <dt>剩余</dt>
            <dd>{{ decimalText(balance.total) }}</dd>
          </div>
          <div v-if="balance.toppedUp !== null">
            <dt>充值余额</dt>
            <dd>{{ decimalText(balance.toppedUp) }}</dd>
          </div>
          <div v-if="balance.granted !== null">
            <dt>赠送余额</dt>
            <dd>{{ decimalText(balance.granted) }}</dd>
          </div>
        </dl>
      </section>
      <div
        class="balance-record"
        v-for="point in snapshot.data?.dailyBalances ?? []"
        :key="point.day + point.currency"
      >
        <strong>{{ point.day }} · {{ decimalText(point.total) }} {{ point.currency }}</strong
        ><small>采集于 {{ formatTimestamp(point.collectedAt, timezone) }}</small>
      </div>
    </template>
    <div v-if="snapshot.data?.masked" class="balance-private" role="status">
      <div class="balance-private-preview" aria-hidden="true">
        <div class="section-heading"><h3>近 7 日剩余余额</h3></div>
        <div class="balance-bars"><i v-for="n in 7" :key="n" /></div>
      </div>
      <span class="balance-private-label">登录后查看</span>
    </div>
    <template v-else>
      <DashboardDataState
        :configured="snapshot.sourceConfigured"
        :error-code="snapshot.errorCode"
        :status="snapshot.status"
        :has-data="!!series.length"
        :empty="!snapshot.data?.balances.length && !snapshot.data?.dailyBalances.length"
        compact
      />
      <figure v-for="s in series.slice(0, 1)" :key="s.currency" class="balance-history">
        <figcaption class="section-heading">
          <h3>近 7 日剩余余额</h3>
          <span>{{ s.currency }}</span>
        </figcaption>
        <ChartsCompactChart type="bar" :label="`近 7 日 ${s.currency} 余额`" :points="s.points" />
      </figure>
      <p v-if="series.length > 1" class="quiet-note">
        另有 {{ series.length - 1 }} 种币种，可在详情查看。
      </p>
    </template>
  </DashboardModuleCard>
</template>
