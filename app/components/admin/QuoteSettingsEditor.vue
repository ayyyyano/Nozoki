<script setup lang="ts">
import type { ConfigWrite } from '../../../shared/contracts/config'
import { moveOrderedItem } from './move-ordered-item'
import { integrationPreset } from '../../../shared/integration-presets'
const props = defineProps<{
  integrations: ConfigWrite['integrations']
  resetToken: number
  locateToken: number
  locateIndex?: number
}>()
const items = defineModel<ConfigWrite['quotes']>({ required: true })
const { index, draft, show, open, edit, apply, remove } = useOrderedItemEditor(items)
const quoteKeys = new WeakMap<object, string>()
let nextQuoteKey = 0
function quoteKey(quote: ConfigWrite['quotes'][number]) {
  const value = toRaw(quote)
  if (!quoteKeys.has(value)) quoteKeys.set(value, `quote-${nextQuoteKey++}`)
  return quoteKeys.get(value)!
}
const order = computed(() => (index.value ?? items.value.length) + 1)
const selectedSource = computed(() =>
  integrationPreset(props.integrations.find((source) => source.id === draft.value?.provider)),
)
function addQuote() {
  if (items.value.length >= 20) return
  open({
    market: 'US',
    symbol: 'NEW',
    displayName: '新标的',
    provider: null,
    sortOrder: items.value.length,
    enabled: true,
    refreshInterval: 300,
  })
}
watch(
  () => props.resetToken,
  () => (show.value = false),
)
watch(
  () => props.locateToken,
  () => {
    if (props.locateIndex !== undefined) edit(props.locateIndex)
  },
)
</script>

<template>
  <section class="admin-module-group">
    <h3>首页展示</h3>
    <ul class="admin-home-items" aria-label="行情标的">
      <AdminHomeOrderRow
        v-for="(quote, i) in items"
        :key="quoteKey(quote)"
        v-model:enabled="quote.enabled"
        :data-edit-quote="quoteKey(quote)"
        :title="quote.displayName || quote.symbol"
        :description="`${quote.market} · ${quote.symbol}`"
        :item-label="`标的 ${quote.symbol}`"
        :enabled-label="`启用标的 ${i + 1}`"
        :index="i"
        :count="items.length"
        @edit="edit(i)"
        @move="moveOrderedItem(items, i, $event)"
      />
    </ul>
    <VarButton
      class="admin-add-button"
      type="primary"
      tonal
      :disabled="items.length >= 20"
      @click="addQuote"
    >
      <CommonAppIcon name="AddRound" :size="20" />添加行情标的
    </VarButton>
    <AdminSourceDialog
      v-model:show="show"
      :title="index === null ? '添加行情标的' : '编辑行情标的'"
      confirm="应用"
      @confirm="apply"
    >
      <template #headerActions>
        <VarButton
          v-if="index !== null"
          text
          round
          type="danger"
          aria-label="移除标的"
          title="移除标的"
          @click="remove"
        >
          <CommonAppIcon name="DeleteRound" :size="20" />
        </VarButton>
      </template>
      <div v-if="draft" class="source-candidate-fields">
        <AdminText v-model="draft.market" :label="`标的 ${order} 市场`" />
        <AdminText v-model="draft.symbol" :label="`标的 ${order} 代码`" />
        <AdminText v-model="draft.displayName" :label="`标的 ${order} 名称`" />
        <AdminNumber v-model="draft.refreshInterval" :label="`标的 ${order} 刷新间隔`" />
        <p class="admin-note">
          {{
            draft.provider
              ? '行情来源：' + (selectedSource?.name ?? '待配置')
              : '添加行情来源后自动匹配'
          }}
        </p>
      </div>
    </AdminSourceDialog>
  </section>
</template>
