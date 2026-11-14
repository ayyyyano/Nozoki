<script setup lang="ts">
import type { DataSnapshot, TailscaleData } from '../../../shared/contracts/dashboard'
import { tailnetState, tailnetSummary } from '../../../shared/domain/tailnet-presentation'
const props = defineProps<{ snapshot: DataSnapshot<TailscaleData>; title: string }>()
const now = useLocalClock()
const nodes = computed(() => props.snapshot.data?.devices ?? [])
const summary = computed(() => tailnetSummary(nodes.value, props.snapshot.homeItems))
const expired = computed(
  () =>
    props.snapshot.status !== 'stale' && tailnetState(null, props.snapshot, now.value) === 'stale',
)
</script>
<template>
  <DashboardModuleCard
    id="tailscale"
    :title="title"
    :status="snapshot.status"
    :has-data="nodes.length > 0"
    :observed-at="snapshot.collectedAt"
    :last-success-at="snapshot.lastSuccessAt"
    time-label="采集于"
    :details="nodes.length > 0"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="nodes.length > 0"
      :empty="!nodes.length"
      compact
    />
    <DashboardTailnetNodes :nodes="summary" :snapshot="snapshot" />
    <p v-if="nodes.length && !summary.length" class="quiet-note">
      未选择首页节点，可在详情中查看。
    </p>
    <template v-if="expired" #freshness>
      <p role="status">数据已过期</p>
    </template>
    <template #details>
      <DashboardTailnetNodes :nodes="nodes" :snapshot="snapshot" detail />
    </template>
  </DashboardModuleCard>
</template>
