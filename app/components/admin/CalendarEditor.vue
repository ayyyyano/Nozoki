<script setup lang="ts">
import type { LegacySchedule } from '../../../shared/schedule'
import { DaySchema } from '../../../shared/contracts/config'
const model = defineModel<LegacySchedule>({ required: true })
const day = ref(''),
  name = ref(''),
  workday = ref(false),
  error = ref('')
function add() {
  if (!DaySchema.safeParse(day.value).success) {
    error.value = '请输入有效的 YYYY-MM-DD 日期'
    return
  }
  model.value.calendar ??= {}
  model.value.calendar[day.value] = {
    workday: workday.value,
    ...(name.value ? { name: name.value } : {}),
  }
  error.value = ''
}
</script>
<template>
  <details class="admin-details">
    <summary>手动日程例外</summary>
    <p class="admin-note">仅作用于指定当地日期，不自动导入节假日。</p>
    <div v-for="(rule, date) in model.calendar ?? {}" :key="date" class="admin-rule">
      <span>{{ date }} · {{ rule.workday ? '工作日' : '休息日' }} · {{ rule.name }}</span
      ><VarButton text :aria-label="`删除例外 ${date}`" @click="delete model.calendar![date]"
        >删除</VarButton
      >
    </div>
    <div class="admin-fields">
      <AdminText v-model="day" label="例外日期 YYYY-MM-DD" :max="10" /><AdminText
        v-model="name"
        label="例外名称"
        :max="100"
      /><label><VarSwitch v-model="workday" aria-label="例外为工作日" />工作日</label
      ><VarButton text @click="add">添加或更新日程例外</VarButton>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </details>
</template>
