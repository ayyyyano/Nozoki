<script setup lang="ts">
import {
  evaluateSchedule,
  localClock,
  localInstant,
  normalizeSchedule,
  prepareSchedule,
  removeScheduleTemplate,
  resolveScheduleForDate,
  toLegacySchedule,
  validateSchedule,
  isLocalDate,
  type DayRule,
  type LegacySchedule,
  type ScheduleInput,
  type SchedulePeriod,
  type Weekday,
  type WeeklySchedule,
} from '../../../shared/schedule'
import { activityScheduleView, scheduleIssueText } from '../../../shared/domain/schedule-view'
import { formatTimestamp } from '../../../shared/domain/format'
const model = defineModel<ScheduleInput>({ required: true })
const props = withDefaults(defineProps<{ resetToken?: number }>(), { resetToken: 0 })
const error = ref(''),
  selectedDay = ref<Weekday>('1'),
  copyTo = ref<Weekday>('2'),
  templateId = ref(''),
  exceptionDate = ref(''),
  exceptionName = ref(''),
  selectedException = ref('')
watch(model, () => (error.value = ''), { deep: true })
const now = useLocalClock('nozoki-schedule-preview-clock')
const previewDateValue = ref(''),
  previewTimeValue = ref('12:00')
const weekdays = [
  ['1', '周一'],
  ['2', '周二'],
  ['3', '周三'],
  ['4', '周四'],
  ['5', '周五'],
  ['6', '周六'],
  ['7', '周日'],
] as const
const custom = computed(() => ('version' in model.value ? model.value : null))
const basic = computed<LegacySchedule>({
  get: () => model.value as LegacySchedule,
  set: (value) => (model.value = value),
})
const mode = computed({
  get: () => (custom.value ? 'custom' : 'basic'),
  set: (value: string) => {
    error.value = ''
    if (value === 'custom') {
      try {
        model.value = normalizeSchedule(model.value)
      } catch {
        error.value = '请先修正基础日程再转换。'
      }
    } else {
      const converted = toLegacySchedule(model.value)
      if (converted) model.value = converted
      else error.value = '当前自定义安排无法无损转换为基础模式，已保留全部草稿。'
    }
  },
})
const inlineCache = new Map<string, SchedulePeriod[]>()
watch(
  () => props.resetToken,
  () => inlineCache.clear(),
)
const dayRule = computed(() => custom.value?.weekdays[selectedDay.value])
function changeRule(rule: DayRule, kind: DayRule['kind'], key: string): DayRule {
  if (rule.kind === 'slots') inlineCache.set(key, structuredClone(toRaw(rule.slots)))
  if (kind === 'slots')
    return {
      kind,
      slots: structuredClone(
        inlineCache.get(key) ??
          (rule.kind === 'template'
            ? toRaw(custom.value?.templates.find((t) => t.id === rule.templateId)?.slots ?? [])
            : []),
      ),
    }
  if (kind === 'template') return { kind, templateId: custom.value?.templates[0]?.id ?? '' }
  return { kind }
}
const dayKind = computed({
  get: () => dayRule.value?.kind ?? 'empty',
  set: (kind: DayRule['kind']) => {
    if (custom.value && dayRule.value)
      custom.value.weekdays[selectedDay.value] = changeRule(
        dayRule.value,
        kind,
        'week-' + selectedDay.value,
      )
  },
})
function copyDay() {
  if (custom.value) {
    inlineCache.delete('week-' + copyTo.value)
    custom.value.weekdays[copyTo.value] = structuredClone(
      toRaw(custom.value.weekdays[selectedDay.value]),
    )
  }
}
const selectedTemplate = computed(() =>
  custom.value?.templates.find((t) => t.id === templateId.value),
)
function addTemplate() {
  if (!custom.value) return
  const id = 'template-' + crypto.randomUUID().slice(0, 12)
  custom.value.templates.push({ id, name: '新模板', slots: [] })
  templateId.value = id
}
function deleteTemplate() {
  if (!custom.value || !templateId.value) return
  try {
    model.value = removeScheduleTemplate(toRaw(custom.value), templateId.value)
    templateId.value = ''
    error.value = ''
  } catch {
    error.value = '该模板仍被星期规则或日期例外引用，请先更换引用。'
  }
}
function addException() {
  if (!custom.value || !isLocalDate(exceptionDate.value)) {
    error.value = '请输入有效的 YYYY-MM-DD 日期'
    return
  }
  const existing = custom.value.exceptions[exceptionDate.value]
  custom.value.exceptions[exceptionDate.value] = {
    ...(existing ?? { rule: { kind: 'rest' } as DayRule }),
    ...(exceptionName.value ? { name: exceptionName.value } : {}),
  }
  selectedException.value = exceptionDate.value
  error.value = ''
}
const exception = computed(() => custom.value?.exceptions[selectedException.value])
const exceptionKind = computed({
  get: () => exception.value?.rule.kind ?? 'rest',
  set: (kind: DayRule['kind']) => {
    if (exception.value)
      exception.value.rule = changeRule(
        exception.value.rule,
        kind,
        'date-' + selectedException.value,
      )
  },
})
function deleteException(date: string) {
  if (custom.value) delete custom.value.exceptions[date]
  inlineCache.delete('date-' + date)
  if (selectedException.value === date) selectedException.value = ''
}
const clock = computed(() => {
  try {
    return localClock(now.value, model.value.timezone)
  } catch {
    return null
  }
})
const previewDate = computed({
  get: () => previewDateValue.value || clock.value?.date || '',
  set: (value: string) => (previewDateValue.value = value),
})
const previewTime = computed({
  get: () =>
    previewDateValue.value ? previewTimeValue.value : (clock.value?.clock.slice(0, 5) ?? '12:00'),
  set: (value: string) => {
    previewDateValue.value = previewDate.value
    previewTimeValue.value = value
  },
})
const validation = computed(() => validateSchedule(model.value))
const prepared = computed(() => {
  try {
    return validation.value.valid && isLocalDate(previewDate.value)
      ? prepareSchedule(validation.value.schedule, previewDate.value)
      : null
  } catch {
    return null
  }
})
const instant = computed(() => {
  try {
    return previewDateValue.value
      ? localInstant(
          previewDate.value,
          previewTime.value,
          model.value.timezone,
          custom.value?.dstDisambiguation ?? 'reject',
        )
      : now.value
  } catch {
    return NaN
  }
})
const preview = computed(() => evaluateSchedule(prepared.value ?? model.value, instant.value))
const basicEquivalent = computed(() => toLegacySchedule(model.value))
const previewView = computed(() =>
  activityScheduleView(preview.value, instant.value, basicEquivalent.value),
)
const resolved = computed(() => {
  try {
    return resolveScheduleForDate(model.value, previewDate.value)
  } catch {
    return null
  }
})
const overrideEnabled = computed({
  get: () => !!custom.value?.override,
  set: (value: boolean) => {
    if (custom.value) {
      if (value) custom.value.override = { text: '临时状态' }
      else delete custom.value.override
    }
  },
})
const overrideStart = computed({
  get: () => custom.value?.override?.startAt ?? '',
  set: (value: string) => {
    if (custom.value?.override) {
      if (value) custom.value.override.startAt = value
      else delete custom.value.override.startAt
    }
  },
})
const overrideEnd = computed({
  get: () => custom.value?.override?.endAt ?? '',
  set: (value: string) => {
    if (custom.value?.override) {
      if (value) custom.value.override.endAt = value
      else delete custom.value.override.endAt
    }
  },
})
</script>
<template>
  <div class="schedule-editor">
    <div class="admin-fields">
      <VarSelect v-model="mode" aria-label="日程编辑模式" placeholder="编辑模式" variant="outlined"
        ><VarOption label="基础模式" value="basic" /><VarOption
          label="自定义周计划"
          value="custom" /></VarSelect
      ><AdminText v-model="model.timezone" label="IANA 时区" :max="100" />
    </div>
    <p v-if="error" role="alert" class="schedule-error">{{ error }}</p>
    <template v-if="!custom">
      <div class="admin-fields">
        <AdminText v-model="basic.start" label="上班时间 HH:mm" :max="5" /><AdminText
          v-model="basic.end"
          label="下班时间 HH:mm"
          :max="5"
        /><AdminText v-model="basic.lunchStart" label="午休开始 HH:mm" :max="5" /><AdminText
          v-model="basic.lunchEnd"
          label="午休结束 HH:mm"
          :max="5"
        /><VarSelect
          v-model="basic.restMode"
          aria-label="休息日规则"
          placeholder="休息日规则"
          variant="outlined"
          ><VarOption label="双休" value="double" /><VarOption label="单休" value="single"
        /></VarSelect>
      </div>
      <AdminCalendarEditor v-model="basic" />
      <p v-if="basic.end < basic.start" class="admin-note">
        跨日基础日程：结束时间及早于开始时间的午休按次日计算。
      </p>
    </template>
    <template v-else>
      <div class="schedule-weekdays" role="group" aria-label="选择星期">
        <VarButton
          v-for="[day, label] in weekdays"
          :key="day"
          text
          :aria-pressed="selectedDay === day"
          @click="selectedDay = day"
          >{{ label }}</VarButton
        >
      </div>
      <div class="admin-fields">
        <VarSelect
          v-model="dayKind"
          :aria-label="`${weekdays.find((d) => d[0] === selectedDay)?.[1]}安排类型`"
          placeholder="当日安排"
          variant="outlined"
          ><VarOption
            label="引用模板"
            value="template"
            :disabled="!custom.templates.length" /><VarOption
            label="独立时段"
            value="slots" /><VarOption label="休息日" value="rest" /><VarOption
            label="不安排"
            value="empty" /></VarSelect
        ><VarSelect
          v-if="dayRule?.kind === 'template'"
          v-model="dayRule.templateId"
          aria-label="星期模板"
          placeholder="模板"
          variant="outlined"
          ><VarOption v-for="t in custom.templates" :key="t.id" :label="t.name" :value="t.id"
        /></VarSelect>
      </div>
      <AdminSchedulePeriods
        v-if="dayRule?.kind === 'slots'"
        v-model="dayRule.slots"
        :label="weekdays.find((d) => d[0] === selectedDay)?.[1] ?? ''"
      />
      <div class="schedule-copy admin-actions">
        <VarSelect v-model="copyTo" aria-label="复制到星期" placeholder="复制到" variant="outlined"
          ><VarOption
            v-for="[day, label] in weekdays"
            :key="day"
            :label="label"
            :value="day" /></VarSelect
        ><VarButton text :disabled="copyTo === selectedDay" @click="copyDay"
          >复制当天安排</VarButton
        >
      </div>
      <details class="admin-details">
        <summary>日程模板</summary>
        <div class="admin-fields">
          <VarSelect
            v-model="templateId"
            aria-label="编辑模板"
            placeholder="选择模板"
            variant="outlined"
            ><VarOption
              v-for="t in custom.templates"
              :key="t.id"
              :label="t.name"
              :value="t.id" /></VarSelect
          ><VarButton text :disabled="custom.templates.length >= 32" @click="addTemplate"
            >添加模板</VarButton
          >
        </div>
        <template v-if="selectedTemplate"
          ><AdminText
            v-model="selectedTemplate.name"
            label="模板名称"
            :max="120"
          /><AdminSchedulePeriods v-model="selectedTemplate.slots" label="模板" /><VarButton
            text
            @click="deleteTemplate"
            >删除模板</VarButton
          ></template
        >
      </details>
      <details class="admin-details">
        <summary>手动日程例外</summary>
        <div class="schedule-exceptions">
          <div v-for="(entry, date) in custom.exceptions" :key="date" class="admin-rule">
            <VarButton
              text
              :aria-label="`编辑例外 ${date}`"
              @click="selectedException = String(date)"
              >{{ date }} {{ entry.name }}</VarButton
            ><VarButton text :aria-label="`删除例外 ${date}`" @click="deleteException(String(date))"
              >删除</VarButton
            >
          </div>
        </div>
        <div class="admin-fields">
          <AdminText v-model="exceptionDate" label="例外日期 YYYY-MM-DD" :max="10" /><AdminText
            v-model="exceptionName"
            label="例外名称"
            :max="100"
          />
        </div>
        <VarButton
          text
          :disabled="
            Object.keys(custom.exceptions).length >= 366 && !custom.exceptions[exceptionDate]
          "
          @click="addException"
          >添加或更新日程例外</VarButton
        >
        <template v-if="exception"
          ><p>{{ selectedException }} · {{ exception.name }}</p>
          <div class="admin-fields">
            <VarSelect
              v-model="exceptionKind"
              aria-label="例外安排类型"
              placeholder="例外类型"
              variant="outlined"
              ><VarOption label="强制休息" value="rest" /><VarOption
                label="活动日 / 引用模板"
                value="template"
                :disabled="!custom.templates.length" /><VarOption
                label="替换当天时段"
                value="slots" /><VarOption label="不安排" value="empty" /></VarSelect
            ><VarSelect
              v-if="exception.rule.kind === 'template'"
              v-model="exception.rule.templateId"
              aria-label="例外模板"
              placeholder="模板"
              variant="outlined"
              ><VarOption v-for="t in custom.templates" :key="t.id" :label="t.name" :value="t.id"
            /></VarSelect>
          </div>
          <AdminSchedulePeriods
            v-if="exception.rule.kind === 'slots'"
            v-model="exception.rule.slots"
            label="例外"
        /></template>
      </details>
      <details class="admin-details">
        <summary>时间边界与临时显示</summary>
        <VarSelect
          v-model="custom.dstDisambiguation"
          aria-label="DST 重复时间策略"
          placeholder="重复时间"
          variant="outlined"
          ><VarOption label="拒绝不明确时间" value="reject" /><VarOption
            label="选择较早一次"
            value="earlier" /><VarOption label="选择较晚一次" value="later" /></VarSelect
        ><label><VarSwitch v-model="overrideEnabled" aria-label="临时状态覆盖" />临时显示</label
        ><template v-if="custom.override"
          ><AdminText v-model="custom.override.text" label="临时状态文字" :max="200" />
          <div class="admin-fields">
            <AdminText v-model="overrideStart" label="临时开始 UTC（可选）" :max="24" /><AdminText
              v-model="overrideEnd"
              label="临时结束 UTC（可选）"
              :max="24"
            />
          </div>
          <p class="admin-note">
            UTC 格式：2026-10-30T12:00:00.000Z。到期恢复自动日程，不代表实际在线或考勤。
          </p></template
        >
      </details>
    </template>
    <ul v-if="!validation.valid" class="schedule-error" role="alert">
      <li v-for="issue in validation.issues.slice(0, 5)" :key="issue.path + issue.message">
        {{ issue.path }}：{{ scheduleIssueText(issue) }}
      </li>
    </ul>
    <section class="schedule-preview" aria-label="日程预览">
      <div class="admin-fields">
        <AdminText v-model="previewDate" label="预览日期 YYYY-MM-DD" :max="10" /><AdminText
          v-model="previewTime"
          label="预览时间 HH:mm"
          :max="5"
        />
      </div>
      <VarButton text @click="previewDateValue = ''">当前时刻</VarButton>
      <template v-if="preview.valid"
        ><strong data-schedule-preview-state>{{ previewView.label }}</strong>
        <p>
          下一变化：{{
            preview.nextChange
              ? formatTimestamp(preview.nextChange.at, model.timezone)
              : '查找范围内暂无安排'
          }}
        </p>
        <ul>
          <li
            v-for="p in [...(resolved?.carryIn ?? []), ...(resolved?.periods ?? [])]"
            :key="p.originDate + p.id"
          >
            {{ p.originDate !== previewDate ? '前一日跨日 · ' : ''
            }}{{ p.startDayOffset ? '次日 ' : '' }}{{ p.start }}–{{ p.endDayOffset ? '次日 ' : ''
            }}{{ p.end }} {{ p.name }}
          </li>
        </ul></template
      >
      <p v-else role="alert">日程预览不可用：{{ scheduleIssueText(preview.issues[0]) }}</p>
    </section>
  </div>
</template>
