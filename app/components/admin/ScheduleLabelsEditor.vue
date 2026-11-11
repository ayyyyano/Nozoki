<script setup lang="ts">
import type { ScheduleLabels } from '../../../shared/schedule'

const model = defineModel<ScheduleLabels | undefined>()
const props = defineProps<{ resetToken: number }>()
const open = ref(false)
const draft = ref<ScheduleLabels>({})
const fields: { key: keyof ScheduleLabels; label: string }[] = [
  { key: 'active', label: '活动状态文字' },
  { key: 'break', label: '休息时段状态文字' },
  { key: 'before', label: '开始前状态文字' },
  { key: 'after', label: '结束后状态文字' },
  { key: 'rest', label: '休息日状态文字' },
  { key: 'free', label: '自由时间状态文字' },
  { key: 'empty', label: '无安排状态文字' },
]
watch(
  () => props.resetToken,
  () => (open.value = false),
)

function edit() {
  draft.value = { ...model.value }
  open.value = true
}

function apply() {
  const labels: ScheduleLabels = {}
  for (const { key } of fields) {
    const value = draft.value[key]
    if (value) labels[key] = value
  }
  model.value = Object.keys(labels).length ? labels : undefined
  open.value = false
}
</script>

<template>
  <VarButton
    text
    type="primary"
    aria-haspopup="dialog"
    class="schedule-labels-action"
    @click="edit"
  >
    <CommonAppIcon name="EditRound" :size="20" />自定义状态文案
  </VarButton>
  <AdminSourceDialog v-model:show="open" title="自定义状态文案" confirm="应用" @confirm="apply">
    <p class="admin-note">留空使用默认文案。自定义时段的专属文案优先。</p>
    <div class="schedule-labels-fields">
      <AdminText
        v-for="{ key, label } in fields"
        :key="key"
        :model-value="draft[key] ?? ''"
        :label="label"
        :max="120"
        @update:model-value="draft[key] = $event"
      />
    </div>
  </AdminSourceDialog>
</template>
