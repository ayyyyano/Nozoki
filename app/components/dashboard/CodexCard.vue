<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp } from '../../../shared/domain/format'
import { quotaExpired } from '../../../shared/collection/policy'
const clock = useLocalClock('nozoki-codex-clock')
const timezone = useDashboardTimezone()
const props = defineProps<{ snapshot: DataSnapshot<CodexData>; title: string }>()
const accountStates = {
  ready: '来源就绪',
  disabled: '已禁用',
  auth_error: '认证错误',
  error: '来源报告错误',
  cooldown: '冷却中',
  unavailable: '不可用',
  pending: '等待操作',
  refreshing: '刷新中',
  unknown: '状态未知',
}
</script>
<template>
  <DashboardModuleCard
    id="codex"
    :title="title"
    :status="snapshot.status"
    :observed-at="snapshot.observedAt"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :empty="!snapshot.data?.accounts?.length && !snapshot.data?.quota?.accounts.length"
      :last-success-at="snapshot.lastSuccessAt"
      compact
    />
    <div v-if="snapshot.data?.accounts?.length" aria-label="Codex 账户状态">
      <div v-for="(account, index) in snapshot.data.accounts" :key="account.id" class="quota-row">
        <span>账户 {{ index + 1 }}</span
        ><span>{{ accountStates[account.state] }}</span>
        <small v-if="account.retryAt">重试 {{ formatTimestamp(account.retryAt, timezone) }}</small>
        <small v-if="account.executionCounts"
          >执行成功 {{ account.executionCounts.success ?? '—' }} / 失败
          {{ account.executionCounts.failed ?? '—' }} · 起点未知</small
        >
      </div>
    </div>
    <div
      v-if="snapshot.data?.quota?.accounts.some((a) => a.windows.length)"
      class="section-heading"
    >
      <h3>配额</h3>
    </div>
    <template v-if="snapshot.data?.quota?.accounts.length"
      ><div v-for="account in snapshot.data.quota.accounts" :key="account.id">
        <div v-for="window in account.windows" :key="window.id" class="quota-row">
          <span>{{ window.label }}</span
          ><strong
            >{{ quotaExpired(window, clock) ? '—' : decimalText(window.remainingPercent)
            }}{{
              !quotaExpired(window, clock) && window.remainingPercent !== null ? '%' : ''
            }}</strong
          >
          <small v-if="window.basis === 'passive_headers'">既往响应观测</small>
          <small v-if="quotaExpired(window, clock)">观测已过期</small>
          <small v-if="window.observedAt">{{ formatTimestamp(window.observedAt, timezone) }}</small>
          <small
            >重置
            {{ window.resetAt ? formatTimestamp(window.resetAt, timezone) : '时间未知' }}</small
          >
        </div>
      </div></template
    >
  </DashboardModuleCard>
</template>
