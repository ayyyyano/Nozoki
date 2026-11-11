<script setup lang="ts">
import { isLocalDate, type LegacySchedule } from '../../../shared/schedule'

const model = defineModel<LegacySchedule>({ required: true })
const props = defineProps<{ resetToken: number }>()
const id = useId()
const open = ref(false)
const editing = ref('')
const day = ref('')
const name = ref('')
const workday = ref(false)
const dateList = useTemplateRef<HTMLUListElement>('dateList')
const heading = useTemplateRef<HTMLHeadingElement>('heading')
let focusDate = ''
const dates = computed(() =>
  Object.entries(model.value.calendar ?? {}).sort(([a], [b]) => a.localeCompare(b)),
)
const duplicate = computed(() => day.value !== editing.value && !!model.value.calendar?.[day.value])
const full = computed(() => dates.value.length >= 366)
const blocked = computed(
  () => !isLocalDate(day.value) || duplicate.value || (!editing.value && full.value),
)

watch(
  () => props.resetToken,
  () => (open.value = false),
)

function edit(date = '') {
  const entry = model.value.calendar?.[date]
  editing.value = date
  day.value = date
  name.value = entry?.name ?? ''
  workday.value = entry?.workday ?? false
  open.value = true
}

function apply() {
  if (blocked.value) return
  const calendar = { ...model.value.calendar }
  if (editing.value) delete calendar[editing.value]
  calendar[day.value] = {
    workday: workday.value,
    ...(name.value ? { name: name.value } : {}),
  }
  model.value = { ...model.value, calendar }
  focusDate = editing.value !== day.value ? day.value : ''
  open.value = false
}

function restoreDateFocus() {
  if (focusDate) focusRow(focusDate)
  focusDate = ''
}

function focusRow(date: string) {
  dateList.value?.querySelector<HTMLButtonElement>(`[data-date="${date}"] button`)?.focus()
}

async function remove(date: string) {
  const index = dates.value.findIndex(([entry]) => entry === date)
  const nextDate = (dates.value[index + 1] ?? dates.value[index - 1])?.[0]
  const calendar = { ...model.value.calendar }
  delete calendar[date]
  model.value = { ...model.value, calendar }
  await nextTick()
  if (nextDate) focusRow(nextDate)
  else heading.value?.focus()
}
</script>

<template>
  <section class="schedule-section" :aria-labelledby="`${id}-title`">
    <header class="schedule-section-heading">
      <h3 :id="`${id}-title`" ref="heading" tabindex="-1">特殊日期</h3>
      <VarButton text type="primary" aria-haspopup="dialog" :disabled="full" @click="edit()">
        <CommonAppIcon name="AddRound" :size="20" />添加特殊日期
      </VarButton>
    </header>
    <p v-if="full" class="admin-note">已达到 366 个特殊日期的上限。</p>
    <p v-if="!dates.length" class="admin-note">暂无特殊日期</p>
    <ul v-else ref="dateList" class="schedule-date-list">
      <li v-for="[date, rule] in dates" :key="date" :data-date="date">
        <div>
          <strong>{{ date }}</strong>
          <span
            >{{ rule.workday ? '工作日' : '休息日' }}{{ rule.name ? ` · ${rule.name}` : '' }}</span
          >
        </div>
        <div class="schedule-date-actions">
          <VarButton
            text
            round
            :aria-label="`编辑特殊日期 ${date}`"
            title="编辑"
            aria-haspopup="dialog"
            @click="edit(date)"
          >
            <CommonAppIcon name="EditRound" :size="20" />
          </VarButton>
          <VarButton
            text
            round
            type="danger"
            :aria-label="`删除特殊日期 ${date}`"
            title="删除"
            @click="remove(date)"
          >
            <CommonAppIcon name="DeleteRound" :size="20" />
          </VarButton>
        </div>
      </li>
    </ul>
    <AdminSourceDialog
      v-model:show="open"
      :title="editing ? '编辑特殊日期' : '添加特殊日期'"
      confirm="应用"
      :blocked="blocked"
      @confirm="apply"
      @closed="restoreDateFocus"
    >
      <label class="schedule-native-field">
        日期
        <input
          v-model="day"
          type="date"
          :aria-invalid="duplicate || undefined"
          :aria-describedby="duplicate ? `${id}-duplicate` : undefined"
        />
      </label>
      <p v-if="duplicate" :id="`${id}-duplicate`" class="schedule-error" role="alert">
        此日期已有安排，可返回列表编辑。
      </p>
      <fieldset class="schedule-date-kind">
        <legend>日期类型</legend>
        <label><input v-model="workday" type="radio" :name="id" :value="true" />工作日</label>
        <label><input v-model="workday" type="radio" :name="id" :value="false" />休息日</label>
      </fieldset>
      <AdminText v-model="name" label="名称（可选）" :max="100" />
    </AdminSourceDialog>
  </section>
</template>
