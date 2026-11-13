<script setup lang="ts">
import type { CodexData, DataSnapshot } from '../../../shared/contracts/dashboard'
import { quotaExpired } from '../../../shared/collection/policy'
import { presentRing, RING_LABELS } from '../../../shared/domain/codex-rings'
import { formatTimestamp } from '../../../shared/domain/format'
const props = defineProps<{ snapshot: DataSnapshot<CodexData>; title: string }>()
const now = useLocalClock()
const timezone = useDashboardTimezone()
const rings = computed(() => props.snapshot.data?.ringView?.rings ?? [])
const home = computed(() =>
  (props.snapshot.data?.ringView?.home ?? []).flatMap((id) =>
    rings.value.filter((ring) => ring.id === id),
  ),
)
const staleRings = computed(() =>
  rings.value.flatMap((ring) => {
    const presented = presentRing(ring, now.value)
    return presented.state === 'stale'
      ? [{ label: RING_LABELS[ring.id], observedAt: presented.last?.observedAt }]
      : []
  }),
)
const staleQuota = computed(() =>
  props.snapshot.data?.quota?.accounts.some((a) =>
    a.windows.some((w) => quotaExpired(w, now.value)),
  ),
)
const extra = computed(() => {
  const data = props.snapshot.data
  return !!(
    data?.quota?.accounts.some((a) => a.windows.length) ||
    data?.usage?.days.length ||
    data?.capabilities?.quota?.reason === 'QUOTA_READ_UNAVAILABLE'
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
    :observed-at="snapshot.collectedAt"
    :last-success-at="snapshot.lastSuccessAt"
    time-label="同步于"
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
    <template v-if="staleRings.length || (snapshot.status !== 'stale' && staleQuota)" #freshness>
      <div v-if="staleRings.length" role="status">
        <p v-for="ring in staleRings" :key="ring.label">
          {{ ring.label }}已过期<span v-if="ring.observedAt">
            · {{ formatTimestamp(new Date(ring.observedAt).toISOString(), timezone) }}</span
          >
        </p>
      </div>
      <p v-else role="status">原始配额观测已过期</p>
    </template>
    <template #details>
      <DashboardCodexRingGrid :rings="rings" :now="now" detail />
      <DashboardCodexAccountDetails v-if="extra" :snapshot="snapshot" />
    </template>
  </DashboardModuleCard>
</template>
