<script setup lang="ts">
import type { ActivityData, DataSnapshot } from '../../../shared/contracts/dashboard'
import { formatTimestamp } from '../../../shared/domain/format'
const props = defineProps<{ snapshot: DataSnapshot<ActivityData>; title: string; now: number }>()
const { state, view, legacy } = useScheduleEvaluation(
  () => props.snapshot.data?.schedule,
  () => props.now,
)
</script>
<template>
  <DashboardModuleCard
    id="activity"
    :title="title"
    icon="clock"
    :status="state.valid ? snapshot.status : snapshot.data ? 'error' : snapshot.status"
  >
    <template v-if="state.valid && snapshot.data">
      <DashboardDataState
        :status="snapshot.status"
        :last-success-at="snapshot.lastSuccessAt"
        compact
      />
      <div
        class="activity-headline"
        :data-schedule-state="state.state"
        :data-period-id="state.current?.id"
      >
        <strong>{{ view.label }}</strong
        ><VarChip size="small" plain>{{ view.tag }}</VarChip>
      </div>
      <p class="metric-caption">{{ view.caption }}</p>
      <div class="countdown" role="timer" :aria-label="view.caption">{{ view.countdown }}</div>
      <VarProgress
        v-if="view.progress !== null"
        :value="view.progress"
        :label="false"
        :line-width="5"
      />
      <div v-if="legacy" class="schedule-times">
        <span>{{ legacy.start }} 上班</span
        ><span>{{ legacy.lunchStart }}–{{ legacy.lunchEnd }} 午休</span
        ><span>{{ legacy.end }} 下班</span>
      </div>
      <div v-else class="schedule-times">
        <span v-for="period in view.periods" :key="period.id" :title="period.text">{{
          period.text
        }}</span>
      </div>
      <p v-if="!legacy && state.nextPeriod" class="scope-note">
        下一安排：{{ state.nextPeriod.name }} ·
        {{ formatTimestamp(state.nextPeriod.startAt, state.timezone) }}
      </p>
      <p class="scope-note">
        计划状态 · {{ state.timezone
        }}<span v-if="view.exceptionName"> · {{ view.exceptionName }}</span>
      </p>
      <details class="capability-note">
        <summary>能力限制</summary>
        按计划计算，不代表实际考勤或在线状态。位置 / 音乐 / PS5：未支持
      </details>
    </template>
    <DashboardDataState v-else :status="snapshot.data ? 'error' : snapshot.status" empty />
  </DashboardModuleCard>
</template>
