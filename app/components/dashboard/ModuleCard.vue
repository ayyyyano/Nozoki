<script setup lang="ts">
import type { DataStatus, ModuleId } from '../../../shared/contracts/dashboard'
import { MODULE_ICONS } from '../../../shared/icons/modules'
import { moduleRole } from '../../../shared/domain/module-layout'
import { summaryStatus, additionalSuccess } from '../../../shared/domain/summary-status'
const open = ref(false)
const tooltip = ref(false)
const refreshTooltip = ref(false)
const refreshing = ref(false)
const slots = useSlots()
const reloadDashboard = inject<() => Promise<void>>('reloadDashboard')
const props = defineProps<{
  id: ModuleId
  title: string
  status: DataStatus
  observedAt?: string | null
  details?: boolean
  hasData?: boolean
  timeLabel?: string
  timeZone?: string
  lastSuccessAt?: string | null
  refreshable?: boolean
}>()
const REFRESH_THROTTLE_MS = 15000
let lastRefreshAt = 0
const feedback = ref('')
const feedbackTone = ref<'success' | 'error'>('success')
const feedbackOpen = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
function showFeedback(message: string, tone: 'success' | 'error') {
  feedback.value = message
  feedbackTone.value = tone
  feedbackOpen.value = true
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => (feedbackOpen.value = false), 4000)
}
onBeforeUnmount(() => {
  if (feedbackTimer) clearTimeout(feedbackTimer)
})
function openDetails() {
  tooltip.value = false
  open.value = true
}
interface RefreshResult {
  ok: boolean
  code?: string
  message?: string
  success?: number
  failure?: number
  collected?: number
}
async function refreshCard() {
  refreshTooltip.value = false
  if (refreshing.value || !reloadDashboard) return
  const now = Date.now()
  if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return
  lastRefreshAt = now
  refreshing.value = true
  try {
    const result = await $fetch<RefreshResult>('/api/collection/refresh', {
      method: 'POST',
      body: { moduleId: props.id },
    })
    if (!result?.ok) {
      showFeedback(result?.message ?? '刷新失败，请稍后重试', 'error')
      return
    }
    await reloadDashboard()
    showFeedback(result.message ?? '刷新完成', result.failure ? 'error' : 'success')
  } catch {
    showFeedback('刷新失败，请检查网络后重试', 'error')
  } finally {
    refreshing.value = false
  }
}
const successTime = computed(() =>
  additionalSuccess(props.status, props.lastSuccessAt, props.observedAt),
)
const hasSubtitle = computed(
  () => props.status === 'stale' || props.observedAt || successTime.value,
)
const showDetails = computed(
  () =>
    (props.details || hasSubtitle.value || !!slots.freshness || !!slots.subtitle) &&
    !!slots.details,
)
</script>
<template>
  <section
    class="module-card"
    :data-layout-role="moduleRole(id)"
    :data-module="id"
    :data-status="status"
    :aria-labelledby="`heading-${id}`"
  >
    <header class="module-header">
      <span class="module-icon"><CommonAppIcon :name="MODULE_ICONS[id]" /></span>
      <h2 :id="`heading-${id}`">{{ title }}</h2>
      <span
        v-if="hasData && status !== 'stale' && summaryStatus(status)"
        class="summary-status"
        :data-status="status"
        role="status"
        >{{ summaryStatus(status) }}</span
      >
      <div v-if="refreshable || showDetails" class="module-header-actions">
        <VarTooltip
          v-if="refreshable"
          v-model:show="refreshTooltip"
          :disabled="refreshing"
          :content="`刷新${title}`"
        >
          <VarButton
            text
            round
            class="module-refresh-button edge-icon-action edge-icon-action--small"
            :aria-label="`刷新${title}`"
            :title="`刷新${title}`"
            :aria-busy="refreshing"
            :disabled="refreshing"
            @focus="refreshTooltip = true"
            @blur="refreshTooltip = false"
            @click="refreshCard"
            ><CommonAppIcon name="RefreshRound" :size="20" :class="{ 'is-refreshing': refreshing }"
          /></VarButton>
        </VarTooltip>
        <VarTooltip
          v-if="showDetails"
          v-model:show="tooltip"
          :disabled="open"
          :content="`查看${title}详情`"
        >
          <VarButton
            text
            round
            class="module-detail-button edge-icon-action edge-icon-action--small"
            :aria-label="`查看${title}详情`"
            :title="`查看${title}详情`"
            aria-haspopup="dialog"
            @focus="tooltip = true"
            @blur="tooltip = false"
            @click="openDetails"
            ><CommonAppIcon name="OpenInFullRound" :size="20"
          /></VarButton>
        </VarTooltip>
      </div>
    </header>
    <div class="module-body"><slot /></div>
    <footer v-if="$slots.footer" class="module-footer"><slot name="footer" /></footer>
    <DashboardModuleDetail v-if="showDetails" v-model:show="open" :title="title" :module-id="id">
      <template v-if="hasSubtitle || $slots.freshness || $slots.subtitle" #subtitle>
        <p v-if="status === 'stale'" role="status">数据已过期</p>
        <slot name="freshness" />
        <slot name="subtitle">
          <DashboardSummaryTime
            v-if="observedAt"
            :value="observedAt"
            :label="timeLabel ?? '观测于'"
            :timezone="timeZone"
          />
        </slot>
        <DashboardSummaryTime
          v-if="successTime"
          :value="successTime"
          label="最近成功"
          :timezone="timeZone"
        />
      </template>
      <slot name="details" :open="open" />
    </DashboardModuleDetail>
    <!-- Stays inside <section> to keep a single root so the grid span variables
         passed via $attrs keep landing on the card. The popup teleports to <body>,
         so the card's inline-size containment cannot capture its fixed positioning. -->
    <VarPopup
      v-if="refreshable"
      v-model:show="feedbackOpen"
      position="bottom"
      teleport="body"
      class="module-refresh-feedback-popup"
      role="status"
      aria-live="polite"
      :overlay="false"
      :lock-scroll="false"
      :default-style="false"
      :close-on-key-escape="false"
    >
      <p class="module-refresh-feedback" :data-tone="feedbackTone">{{ feedback }}</p>
    </VarPopup>
  </section>
</template>
