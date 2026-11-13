<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
import { decimalText, formatTimestamp } from '../../../shared/domain/format'
const timezone = useDashboardTimezone()
defineProps<{ snapshot: DataSnapshot<CodexData> }>()
</script>
<template>
  <section class="codex-detail-data" aria-label="额度与用量">
    <p
      v-if="snapshot.data?.capabilities?.quota?.reason === 'QUOTA_READ_UNAVAILABLE'"
      class="quiet-note"
    >
      本轮额度查询未成功，下轮定时采集会重试。
    </p>
    <details v-if="snapshot.data?.quota?.accounts.some((a) => a.windows.length)">
      <summary>原始配额观测</summary>
      <div v-for="(account, index) in snapshot.data.quota.accounts" :key="account.id">
        <h3 v-if="snapshot.data.quota.accounts.length > 1">账户 {{ index + 1 }}</h3>
        <div v-for="window in account.windows" :key="window.id" class="quota-row">
          <span>{{ window.label }}</span
          ><strong
            >{{ decimalText(window.remainingPercent)
            }}{{ window.remainingPercent !== null ? '%' : '' }}</strong
          >
          <small v-if="window.basis === 'passive_headers'">既往响应观测</small>
          <small v-if="window.basis === 'quota_read'">定时额度查询</small>
          <small v-if="window.observedAt">{{ formatTimestamp(window.observedAt, timezone) }}</small>
          <small
            >重置
            {{ window.resetAt ? formatTimestamp(window.resetAt, timezone) : '时间未知' }}</small
          >
        </div>
      </div>
    </details>
    <DashboardCodexUsage v-if="snapshot.data?.usage?.days.length" :usage="snapshot.data.usage" />
  </section>
</template>
