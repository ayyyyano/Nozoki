<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
const props = defineProps<{ snapshot: DataSnapshot<CodexData>; title: string }>()
const now = useLocalClock()
const rings = computed(() => props.snapshot.data?.ringView?.rings ?? [])
const home = computed(() =>
  (props.snapshot.data?.ringView?.home ?? []).flatMap((id) =>
    rings.value.filter((ring) => ring.id === id),
  ),
)
const extra = computed(() => {
  const data = props.snapshot.data
  return !!(
    data?.accounts?.length ||
    data?.quota?.accounts.some((a) => a.windows.length) ||
    data?.usage?.days.length
  )
})
const details = computed(
  () =>
    extra.value ||
    rings.value.some(
      (r) => r.state === 'progress' || (r.state === 'remaining' && !home.value.includes(r)),
    ),
)
</script>
<template>
  <DashboardModuleCard
    id="codex"
    :title="title"
    :status="snapshot.status"
    :details="details"
    :has-data="home.length > 0"
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="home.length > 0"
      compact
    />
    <DashboardCodexRingGrid :rings="home" :now="now" />
    <template #details>
      <DashboardCodexRingGrid :rings="rings" :now="now" detail />
      <DashboardCodexAccountDetails v-if="extra" :snapshot="snapshot" />
    </template>
  </DashboardModuleCard>
</template>
