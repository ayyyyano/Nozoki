<script setup lang="ts">
import { sortSchedulePeriods, type SchedulePeriod } from '../../../shared/schedule'
import { newSchedulePeriod } from '../../../shared/domain/schedule-editor'
const model = defineModel<SchedulePeriod[]>({ required: true })
const props = defineProps<{ label: string }>()
function add() {
  model.value.push(
    newSchedulePeriod('period-' + crypto.randomUUID().slice(0, 12), model.value.at(-1)),
  )
}
function sort() {
  model.value = sortSchedulePeriods(toRaw(model.value))
}
</script>
<template>
  <div class="schedule-periods">
    <div v-for="(period, index) in model" :key="period.id" class="schedule-period">
      <div class="admin-fields">
        <AdminText v-model="period.name" :label="`${label}时段 ${index + 1} 名称`" :max="120" />
        <VarSelect
          v-model="period.category"
          :aria-label="`${label}时段 ${index + 1} 类别`"
          placeholder="类别"
          variant="outlined"
          ><VarOption label="活动" value="active" /><VarOption
            label="休息"
            value="break" /><VarOption label="自由" value="free"
        /></VarSelect>
        <AdminText
          v-model="period.start"
          :label="`${label}时段 ${index + 1} 开始 HH:mm`"
          :max="5"
        />
        <AdminText v-model="period.end" :label="`${label}时段 ${index + 1} 结束 HH:mm`" :max="5" />
        <VarSelect
          v-model="period.startDayOffset"
          :aria-label="`${label}时段 ${index + 1} 开始日期`"
          placeholder="开始日期"
          variant="outlined"
          ><VarOption label="当日" :value="0" /><VarOption label="次日" :value="1"
        /></VarSelect>
        <VarSelect
          v-model="period.endDayOffset"
          :aria-label="`${label}时段 ${index + 1} 结束日期`"
          placeholder="结束日期"
          variant="outlined"
          ><VarOption label="当日" :value="0" /><VarOption label="次日" :value="1"
        /></VarSelect>
      </div>
      <VarButton text :aria-label="`删除${label}时段 ${index + 1}`" @click="model.splice(index, 1)"
        ><CommonAppIcon name="close" :size="18" />删除时段</VarButton
      >
    </div>
    <div class="admin-actions">
      <VarButton text :disabled="model.length >= 24" @click="add">添加{{ label }}时段</VarButton
      ><VarButton text :disabled="model.length < 2" @click="sort">按时间排序</VarButton>
    </div>
  </div>
</template>
