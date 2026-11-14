<script setup lang="ts">
import type { ConfigWrite } from '../../../shared/contracts/config'
import { moveOrderedItem } from './move-ordered-item'
import { integrationPreset } from '../../../shared/integration-presets'
const props = defineProps<{
  integrations: ConfigWrite['integrations']
  resetToken: number
  locateToken: number
}>()
const items = defineModel<ConfigWrite['quotes']>({ required: true })
const expandedQuotes = ref<Record<string, boolean>>({})
const quoteKeys = new WeakMap<object, string>()
let nextQuoteKey = 0
function quoteKey(quote: ConfigWrite['quotes'][number]) {
  const value = toRaw(quote)
  if (!quoteKeys.has(value)) quoteKeys.set(value, `quote-${nextQuoteKey++}`)
  return quoteKeys.get(value)!
}
function removeQuote(index: number) {
  const [quote] = items.value.splice(index, 1)
  if (quote) delete expandedQuotes.value[quoteKey(quote)]
}
function addQuote() {
  items.value.push({
    market: 'US',
    symbol: 'NEW',
    displayName: '新标的',
    provider: null,
    sortOrder: items.value.length,
    enabled: true,
    refreshInterval: 300,
  })
  expandedQuotes.value[quoteKey(items.value.at(-1)!)] = true
}
watch(
  () => props.resetToken,
  () => (expandedQuotes.value = {}),
)
watch(
  () => props.locateToken,
  () => {
    expandedQuotes.value = Object.fromEntries(items.value.map((item) => [quoteKey(item), true]))
  },
)
</script>
<template>
  <section class="admin-module-group">
    <h3>行情标的</h3>
    <AdminEditorItem
      v-for="(q, index) in items"
      :key="quoteKey(q)"
      v-model:open="expandedQuotes[quoteKey(q)]"
      :title="q.symbol"
      :description="q.displayName"
      :status="q.market"
      icon="chart"
      class="admin-quote-card admin-order-card"
      :data-edit-quote="quoteKey(q)"
    >
      <template #actions>
        <VarButton
          text
          round
          :disabled="index === 0"
          :aria-label="`上移标的 ${q.symbol}`"
          :title="`上移 ${q.symbol}`"
          @click="moveOrderedItem(items, index, -1)"
          ><CommonAppIcon name="up" :size="20"
        /></VarButton>
        <VarButton
          text
          round
          :disabled="index === items.length - 1"
          :aria-label="`下移标的 ${q.symbol}`"
          :title="`下移 ${q.symbol}`"
          @click="moveOrderedItem(items, index, 1)"
          ><CommonAppIcon name="down" :size="20"
        /></VarButton>
        <VarButton
          text
          round
          type="danger"
          :aria-label="`移除标的 ${q.symbol}`"
          :title="`移除 ${q.symbol}`"
          @click="removeQuote(index)"
          ><CommonAppIcon name="DeleteRound" :size="20"
        /></VarButton>
        <VarSwitch
          v-model="q.enabled"
          :aria-label="`启用标的 ${index + 1}`"
          :title="`启用或停用 ${q.symbol}`"
        />
      </template>
      <div class="admin-fields">
        <AdminText v-model="q.market" :label="`标的 ${index + 1} 市场`" reserve-details /><AdminText
          v-model="q.symbol"
          :label="`标的 ${index + 1} 代码`"
          reserve-details
        /><AdminText v-model="q.displayName" :label="`标的 ${index + 1} 名称`" reserve-details />
        <p class="admin-note">
          {{
            q.provider
              ? '行情来源：' +
                (integrationPreset(integrations.find((i) => i.id === q.provider))?.name ?? '待配置')
              : '添加行情来源后自动匹配'
          }}
        </p>
        <AdminNumber
          v-model="q.refreshInterval"
          :label="`标的 ${index + 1} 刷新间隔`"
          class="admin-quote-refresh"
        />
      </div>
    </AdminEditorItem>
    <VarButton
      class="admin-add-button"
      type="primary"
      tonal
      :disabled="items.length >= 20"
      @click="addQuote"
      ><CommonAppIcon name="AddRound" :size="20" />添加行情标的</VarButton
    >
  </section>
</template>
