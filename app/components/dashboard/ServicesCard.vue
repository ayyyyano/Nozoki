<script setup lang="ts">
import type { DataSnapshot, ServicesData } from '../../../shared/contracts/dashboard'
import { serviceSummary } from '../../../shared/domain/home-summary'
const props = defineProps<{ snapshot: DataSnapshot<ServicesData>; title: string }>()
const now = useLocalClock()
const summary = computed(() => serviceSummary(props.snapshot, now.value))
</script>
<template>
  <DashboardModuleCard
    id="services"
    :title="title"
    :status="snapshot.status"
    :has-data="!!summary.total"
    :observed-at="snapshot.collectedAt"
    :last-success-at="snapshot.lastSuccessAt"
    time-label="采集于"
    :details="
      summary.total > summary.items.length ||
      !!snapshot.data?.monitors.some(
        (m) =>
          m.checkedAt ||
          m.statusPageUrl ||
          m.uptimePercent !== null ||
          (m.displayId && m.displayId !== m.name),
      )
    "
  >
    <DashboardDataState
      :configured="snapshot.sourceConfigured"
      :error-code="snapshot.errorCode"
      :status="snapshot.status"
      :has-data="!!summary.total"
      :empty="!summary.total"
      compact
    />
    <p v-if="snapshot.partialFailures" class="scope-note" role="status">
      {{ snapshot.partialFailures }} 个来源暂不可用，采集失败不代表服务离线。
    </p>
    <DashboardMonitorList :monitors="summary.items" :snapshot="snapshot" />
    <p v-if="summary.total && !summary.items.length" class="quiet-note">
      未选择首页服务，可在详情中查看。
    </p>
    <template v-if="summary.down || summary.unknown" #footer>
      <span role="status" aria-label="全部监控状态">
        <span v-if="summary.down">异常 {{ summary.down }}</span
        ><span v-if="summary.down && summary.unknown"> · </span
        ><span v-if="summary.unknown">待确认 {{ summary.unknown }}</span>
      </span>
    </template>
    <template #details>
      <DashboardDataState :status="snapshot.status" :empty="!summary.total" compact />
      <p class="quiet-note">完整可见监控 · {{ summary.total }} 项</p>
      <DashboardMonitorList :monitors="snapshot.data?.monitors ?? []" :snapshot="snapshot" detail />
    </template>
  </DashboardModuleCard>
</template>
