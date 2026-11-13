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
    <template v-if="!snapshot.data?.masked" #details>
      <DashboardDataState :status="snapshot.status" compact />
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
      <span class="balance-private-label">登录后查看余额</span>
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
      <p v-if="series.length > 1" class="quiet-note">
        另有 {{ series.length - 1 }} 种币种，可在详情查看。
      </p>
    </template>
  </DashboardModuleCard>
</template>
