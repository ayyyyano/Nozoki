<script setup lang="ts">
import type { Quote } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp, signedDecimal } from '../../../shared/domain/format'
import { quoteSeries } from '../../../shared/domain/chart-series'
const props = defineProps<{ items: Quote[]; detail?: boolean; interactive?: boolean }>()
const timezone = useDashboardTimezone()
const selected = ref<string>()
const rows = computed(() =>
  props.items.map((quote) => ({
    id: JSON.stringify([quote.market, quote.symbol, quote.provider]),
    quote,
    points: quoteSeries(quote, (at) => formatTimestamp(at, timezone.value).slice(0, 10)),
  })),
)
const active = computed(
  () =>
    rows.value.find((row) => row.id === selected.value) ??
    rows.value.find((row) => row.points.some((p) => p.value !== null)),
)
</script>
<template>
  <div class="quote-list">
    <article v-for="{ quote, id, points } in rows" :key="id">
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
      <ChartsTimeSeriesChart
        v-if="interactive && id === active?.id"
        type="line"
        :label="`${quote.symbol} 历史报价`"
        :points="points"
      />
      <template v-else>
        <ChartsCompactChart
          v-if="points.length"
          type="line"
          :label="`${quote.symbol} 历史报价`"
          :points="points"
        />
        <button
          v-if="interactive && points.some((p) => p.value !== null)"
          type="button"
          class="chart-text-button"
          @click="selected = id"
        >
          查看{{ quote.symbol }}图表
        </button>
      </template>
      <dl
        v-if="
          detail &&
          (quote.previousClose !== null || quote.amplitudePercent !== null || quote.volume !== null)
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
      <div v-if="detail && quote.history?.length" class="quote-history">
        <h4>历史报价</h4>
        <dl>
          <div v-for="point in quote.history" :key="point.at">
            <dt>{{ formatTimestamp(point.at, timezone) }}</dt>
            <dd>{{ decimalText(point.close) }}</dd>
          </div>
        </dl>
      </div>
    </article>
  </div>
</template>
