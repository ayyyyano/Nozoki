<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
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
    <DashboardCodexUsage v-if="snapshot.data?.usage?.days.length" :usage="snapshot.data.usage" />
  </section>
</template>
