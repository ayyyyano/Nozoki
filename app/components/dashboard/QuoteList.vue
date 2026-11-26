<script setup lang="ts">
import type { Quote } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp, signedDecimal } from '../../../shared/domain/format'
import { quoteSeries } from '../../../shared/domain/chart-series'
const props = defineProps<{ items: Quote[]; detail?: boolean }>()
const timezone = useDashboardTimezone()
const list = useTemplateRef<HTMLElement>('list')
const ids = useId()
const wide = ref(false)
const expanded = ref<string>()
let resize: ResizeObserver | undefined
const rows = computed(() =>
  props.items.map((quote) => ({
    id: JSON.stringify([quote.market, quote.symbol, quote.provider]),
    quote,
    points: quoteSeries(quote, (at) => formatTimestamp(at, timezone.value)),
  })),
)
onMounted(() => {
  if (!props.detail || !list.value) return
  const element = list.value
  const sync = () => {
    const next = element.clientWidth >= 560
    if (next !== wide.value) expanded.value = undefined
    wide.value = next
  }
  sync()
  resize = new ResizeObserver(sync)
  resize.observe(element)
})
onBeforeUnmount(() => resize?.disconnect())
watch(rows, (next) => {
  if (expanded.value && !next.some(({ id }) => id === expanded.value)) expanded.value = undefined
})
const axisDate = (label: string) => label.slice(5, 10)
</script>
<template>
  <div
    ref="list"
    class="quote-list"
    :class="{ 'quote-list-detail': detail }"
    :data-wide="detail ? wide : undefined"
  >
    <article
      v-for="({ quote, id, points }, index) in rows"
      :key="id"
      :class="{ 'quote-item': detail }"
    >
      <div class="quote-summary">
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
          :data-direction="(quote.change ?? quote.changePercent)?.startsWith('-') ? 'down' : 'up'"
        >
          <span v-if="quote.change !== null">{{ signedDecimal(quote.change) }}</span>
          <span v-if="quote.changePercent !== null"
            >({{ signedDecimal(quote.changePercent) }}%)</span
          >
        </p>
        <button
          v-if="detail && !wide"
          type="button"
          class="monitor-history-toggle quote-toggle"
          :aria-label="`${expanded === id ? '收起' : '展开'} ${quote.symbol} 行情`"
          :aria-expanded="expanded === id"
          :aria-controls="`${ids}-quote-${index}`"
          @click="expanded = expanded === id ? undefined : id"
        >
          <CommonAppIcon name="chevronDown" :size="20" />
        </button>
      </div>
      <ChartsCompactChart
        v-if="!detail && points.length"
        type="line"
        :label="`${quote.symbol} 历史报价`"
        :points="points"
      />
      <div
        v-if="detail"
        :id="`${ids}-quote-${index}`"
        class="quote-expanded"
        :hidden="!wide && expanded !== id"
      >
        <template v-if="wide || expanded === id">
          <ChartsTimeSeriesChart
            type="line"
            :label="`${quote.symbol} 历史报价`"
            :points="points"
            :category-label="axisDate"
          />
          <dl
            v-if="
              quote.previousClose !== null ||
              quote.amplitudePercent !== null ||
              quote.volume !== null
            "
            class="quote-details"
          >
            <div v-if="quote.previousClose !== null">
              <dt>昨收</dt>
              <dd>{{ decimalText(quote.previousClose) }}</dd>
            </div>
            <div v-if="quote.amplitudePercent !== null">
              <dt>振幅</dt>
              <dd>{{ decimalText(quote.amplitudePercent) }}%</dd>
            </div>
            <div v-if="quote.volume !== null">
              <dt>成交</dt>
              <dd>{{ decimalText(quote.volume) }} {{ quote.volumeUnit }}</dd>
            </div>
          </dl>
          <details v-if="quote.history?.length" class="quote-history detail-disclosure">
            <summary>
              历史报价
              <CommonAppIcon name="chevronDown" :size="20" />
            </summary>
            <dl>
              <div v-for="point in quote.history" :key="point.at">
                <dt>{{ formatTimestamp(point.at, timezone) }}</dt>
                <dd>
                  {{ decimalText(point.close) }}
                  <template v-if="point.close !== null">{{ quote.currency }}</template>
                </dd>
              </div>
            </dl>
          </details>
        </template>
      </div>
    </article>
  </div>
</template>
