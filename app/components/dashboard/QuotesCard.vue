<script setup lang="ts">
import type { DataSnapshot, Quote, QuotesData } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp, signedDecimal } from '../../../shared/domain/format'
defineProps<{ snapshot: DataSnapshot<QuotesData>; title: string }>()
const timezone = useDashboardTimezone()
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
        <details
          v-if="
            quote.previousClose !== null ||
            quote.amplitudePercent !== null ||
            quote.volume !== null ||
            quote.asOf ||
            snapshot.observedAt ||
            quote.delayedMinutes !== null
          "
          class="capability-note quote-extra"
        >
          <summary>行情明细</summary>
          <dl class="quote-details">
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
          <p v-if="quote.asOf || quote.delayedMinutes !== null" class="quote-time">
            {{ quote.asOf ? formatTimestamp(quote.asOf, timezone) : '报价时间未知' }} ·
            {{ quote.delayedMinutes === null ? '延迟未知' : `延迟 ${quote.delayedMinutes} 分钟` }}
          </p>
          <p v-if="!quote.asOf && snapshot.observedAt" class="quote-time">
            观测于 {{ formatTimestamp(snapshot.observedAt, timezone) }}
          </p>
        </details>
      </article>
    </div>
  </DashboardModuleCard>
</template>
