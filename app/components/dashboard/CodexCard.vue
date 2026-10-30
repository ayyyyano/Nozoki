<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp } from '../../../shared/domain/format'
import { quotaExpired } from '../../../shared/collection/policy'
const clock = useLocalClock('nozoki-codex-clock')
const timezone = useDashboardTimezone()
const props = defineProps<{ snapshot: DataSnapshot<CodexData>; title: string }>()
const latest = computed(() => props.snapshot.data?.usage?.days.at(-1))
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
    icon="code"
    :status="snapshot.status"
    :observed-at="snapshot.observedAt"
  >
    <template v-if="latest">
      <div class="metric-caption">
        Token 用量 <span>{{ latest.day }}</span>
      </div>
      <strong class="metric-value"
        >{{ latest ? decimalText(String(latest.total)) : '—' }}<small>tokens</small></strong
      >
      <div class="inline-metrics">
        <span
          >输入 <b>{{ latest ? decimalText(String(latest.input)) : '—' }}</b></span
        ><span
          >输出 <b>{{ latest ? decimalText(String(latest.output)) : '—' }}</b></span
        >
      </div>
    </template>
    <DashboardDataState
      :status="snapshot.status"
      :empty="
        !snapshot.data?.usage?.days.length &&
        !snapshot.data?.accounts?.length &&
        !snapshot.data?.quota?.accounts.length
      "
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
    <div v-if="snapshot.data" class="section-heading">
      <h3>配额</h3>
      <span>与 Token 用量独立</span>
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
    <p v-else-if="snapshot.data" class="quiet-note">
      {{
        snapshot.data?.capabilities.quota.supported === false
          ? '来源不支持配额读取'
          : '配额能力尚未验证'
      }}
    </p>
    <p v-if="snapshot.data?.usage" class="scope-note">统计范围：{{ snapshot.data.usage.scope }}</p>
    <p v-if="snapshot.data?.estimatedCost" class="scope-note">
      估算费用 {{ snapshot.data.estimatedCost.currency }}
      {{ decimalText(snapshot.data.estimatedCost.amount) }} ·
      {{ snapshot.data.estimatedCost.basis }}
    </p>
  </DashboardModuleCard>
</template>
