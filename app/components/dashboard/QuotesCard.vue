<script setup lang="ts">
import type { DataSnapshot, Quote, QuotesData } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp, signedDecimal } from '../../../shared/domain/format'
const props = defineProps<{ snapshot: DataSnapshot<QuotesData>; title: string }>()
const timezone = useDashboardTimezone()
const updates = computed(() => {
  const items = props.snapshot.data?.items ?? []
  const times = items
    .map((quote) => ({
      symbol: quote.symbol,
      at: quote.asOf ?? props.snapshot.observedAt,
      label: quote.asOf ? '报价于' : '观测于',
      delayedMinutes: quote.delayedMinutes,
    }))
    .filter((time) => time.at || time.delayedMinutes !== null)
  if (!times.length)
    return props.snapshot.observedAt
      ? [{ symbol: '', at: props.snapshot.observedAt, label: '观测于', delayedMinutes: null }]
      : []
  const first = times[0]!
  return times.length === items.length &&
    times.every(
      (time) =>
        time.at === first.at &&
        time.label === first.label &&
        time.delayedMinutes === first.delayedMinutes,
    )
    ? [{ ...first, symbol: '' }]
    : times
})
function chartPoints(quote: Quote): string | null {
  // The public DTO strips internal capability metadata; the presence of a validated history
  // array is the safe server-side signal that this optional field is allowed.
  if (!Array.isArray(quote.history) || quote.history.length < 2) return null
  const values = quote.history.map((p) => Number(p.close))
  if (values.some((v) => !Number.isFinite(v))) return null
  const min = Math.min(...values)
  const range = Math.max(...values) - min || 1
  return values
    .map((v, i) => `${(i / (values.length - 1)) * 240},${50 - ((v - min) / range) * 42}`)
    .join(' ')
}
</script>
<template>
  <DashboardModuleCard id="quotes" :title="title" :status="snapshot.status">
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :empty="!snapshot.data?.items.length"
      :last-success-at="snapshot.lastSuccessAt"
      compact
    />
    <div class="quote-list">
      <article
        v-for="quote in snapshot.data?.items ?? []"
        :key="`${quote.market}:${quote.symbol}:${quote.provider}`"
        class="quote-item"
      >
        <div class="quote-title">
          <h3>{{ quote.symbol }}</h3>
          <span :title="quote.name" tabindex="0">{{ quote.name }}</span>
        </div>
        <div class="quote-price">
          <strong>{{ decimalText(quote.price) }}</strong
          ><small>{{ quote.currency ?? '币种未知' }}</small>
        </div>
        <p
          v-if="quote.change !== null || quote.changePercent !== null"
          class="quote-change"
          :data-direction="
            quote.change?.startsWith('-') ? 'down' : quote.change === null ? 'unknown' : 'up'
          "
        >
          {{ signedDecimal(quote.change) }}
          <span>{{
            quote.changePercent === null ? '' : `(${signedDecimal(quote.changePercent)}%)`
          }}</span>
        </p>
        <svg
          v-if="chartPoints(quote)"
          class="quote-chart"
          viewBox="0 0 240 56"
          role="img"
          :aria-label="`${quote.symbol} 历史报价`"
        >
          <polyline
            :points="chartPoints(quote)!"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
        </svg>
        <dl
          v-if="
            quote.previousClose !== null || quote.amplitudePercent !== null || quote.volume !== null
          "
          class="quote-details"
        >
          <div v-if="quote.previousClose !== null">
            <dt>昨收</dt>
            <dd>{{ decimalText(quote.previousClose) }}</dd>
          </div>
          <div v-if="quote.amplitudePercent !== null">
            <dt>振幅</dt>
            <dd>
              {{ decimalText(quote.amplitudePercent)
              }}{{ quote.amplitudePercent !== null ? '%' : '' }}
            </dd>
          </div>
          <div v-if="quote.volume !== null">
            <dt>成交</dt>
            <dd>{{ decimalText(quote.volume) }} {{ quote.volumeUnit }}</dd>
          </div>
        </dl>
      </article>
    </div>
    <template v-if="updates.length" #footer>
      <p v-for="(update, index) in updates" :key="index">
        <span v-if="update.symbol">{{ update.symbol }} · </span
        >{{ update.at ? update.label : '报价时间未知' }}
        <time v-if="update.at" :datetime="update.at">{{
          formatTimestamp(update.at, timezone)
        }}</time>
        <span v-if="update.delayedMinutes !== null"> · 延迟 {{ update.delayedMinutes }} 分钟</span>
      </p>
    </template>
  </DashboardModuleCard>
</template>
