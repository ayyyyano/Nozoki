<script setup lang="ts">
import type { DataSnapshot, TailscaleData } from '../../../shared/contracts/dashboard'
import { tailnetSummary } from '../../../shared/domain/tailnet-presentation'
const props = defineProps<{ snapshot: DataSnapshot<TailscaleData>; title: string }>()
const nodes = computed(() => props.snapshot.data?.devices ?? [])
const summary = computed(() => tailnetSummary(nodes.value))
</script>
<template>
  <DashboardModuleCard
    id="tailscale"
    :title="title"
    :status="snapshot.status"
    :has-data="nodes.length > 0"
    :observed-at="nodes.length ? snapshot.collectedAt : null"
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
    <template #details>
      <DashboardTailnetNodes :nodes="nodes" :snapshot="snapshot" detail />
    </template>
  </DashboardModuleCard>
</template>
