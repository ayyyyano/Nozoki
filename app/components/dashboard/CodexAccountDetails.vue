<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp } from '../../../shared/domain/format'
import { quotaExpired } from '../../../shared/collection/policy'
const clock = useLocalClock('nozoki-codex-clock')
const timezone = useDashboardTimezone()
const props = defineProps<{ snapshot: DataSnapshot<CodexData> }>()
function expired(window: { resetAt: string | null; status?: string; observedAt?: string | null }) {
  return (
    props.snapshot.status !== 'ok' ||
    (!!props.snapshot.expiresAt && Date.parse(props.snapshot.expiresAt) <= clock.value) ||
    quotaExpired(window, clock.value)
  )
}
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
  <section aria-label="账户与用量">
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
    <details v-if="snapshot.data?.quota?.accounts.some((a) => a.windows.length)">
      <summary>原始配额观测</summary>
      <div v-for="(account, index) in snapshot.data.quota.accounts" :key="account.id">
        <h3 v-if="snapshot.data.quota.accounts.length > 1">账户 {{ index + 1 }}</h3>
        <div v-for="window in account.windows" :key="window.id" class="quota-row">
          <span>{{ window.label }}</span
          ><strong
            >{{ expired(window) ? '—' : decimalText(window.remainingPercent)
            }}{{ !expired(window) && window.remainingPercent !== null ? '%' : '' }}</strong
          >
          <small v-if="window.basis === 'passive_headers'">既往响应观测</small>
          <small v-if="expired(window)">观测已过期</small>
          <small v-if="window.observedAt">{{ formatTimestamp(window.observedAt, timezone) }}</small>
          <small
            >重置
            {{ window.resetAt ? formatTimestamp(window.resetAt, timezone) : '时间未知' }}</small
          >
        </div>
      </div>
    </details>
    <DashboardCodexUsage v-if="snapshot.data?.usage" :usage="snapshot.data.usage" detail />
    <p v-else-if="snapshot.data?.accounts?.length" class="quiet-note">暂无队列用量</p>
  </section>
</template>
