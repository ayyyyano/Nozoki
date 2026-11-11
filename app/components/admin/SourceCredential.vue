<script setup lang="ts">
import type { IntegrationDraft, SecretField } from '../../../shared/integration-presets'
const model = defineModel<IntegrationDraft['credential']>({ required: true })
const props = withDefaults(
  defineProps<{
    label: string
    configured: boolean
    fields: readonly SecretField[]
    canReplace?: boolean
  }>(),
  { canReplace: true },
)
const clearing = ref(false),
  visible = ref(false),
  panel = useTemplateRef<HTMLElement>('panel')
const editing = computed(
  () =>
    props.canReplace &&
    (model.value.operation === 'replace' ||
      (!props.configured && model.value.operation === 'keep')),
)
watch(
  () => model.value.operation,
  () => {
    visible.value = false
  },
)
function value(field: SecretField) {
  if (model.value.operation !== 'replace') return ''
  if (field.key === 'value') return model.value.value
  try {
    const value = JSON.parse(model.value.value)[field.key]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}
function input(field: SecretField, raw: unknown) {
  const text = typeof raw === 'string' ? raw : ''
  if (field.key === 'value') {
    model.value = { operation: 'replace', value: text }
    return
  }
  const data = Object.fromEntries(props.fields.map((f) => [f.key, value(f)]))
  data[field.key] = text
  model.value = { operation: 'replace', value: JSON.stringify(data) }
}
async function edit() {
  model.value = { operation: 'replace', value: '' }
  await nextTick()
  panel.value?.querySelector<HTMLInputElement>('input')?.focus()
}
function cancel() {
  model.value = { operation: 'keep' }
  visible.value = false
}
function clear() {
  model.value = { operation: 'clear' }
  clearing.value = false
  visible.value = false
}
</script>
<template>
  <div ref="panel" class="source-credential">
    <div v-if="configured && model.operation === 'keep'" class="source-secret-summary">
      <span
        ><strong>{{ label }}</strong
        ><span class="source-secret-placeholder" aria-hidden="true">••••••••</span
        ><small>已配置</small></span
      >
      <div class="admin-actions">
        <VarButton v-if="canReplace" text @click="edit">编辑</VarButton
        ><VarButton text round type="danger" :aria-label="`删除${label}`" @click="clearing = true"
          ><CommonAppIcon name="DeleteRound" :size="20"
        /></VarButton>
      </div>
    </div>
    <template v-if="editing">
      <div v-for="field in fields" :key="field.key" class="source-secret-input">
        <VarInput
          :model-value="value(field)"
          :placeholder="configured ? `新 ${field.label}` : field.label"
          :aria-label="configured ? `新 ${field.label}` : field.label"
          :type="field.secret && !visible ? 'password' : 'text'"
          autocomplete="new-password"
          :prevent-auto-fill="false"
          :maxlength="field.max"
          variant="outlined"
          @update:model-value="input(field, $event)"
        >
          <template v-if="field.secret" #append-icon
            ><VarButton
              text
              round
              class="edge-icon-action edge-icon-action--small"
              :aria-label="`${visible ? '隐藏' : '显示'}新${field.label}`"
              :aria-pressed="visible"
              @click="visible = !visible"
              ><CommonAppIcon :name="visible ? 'eyeOff' : 'eye'" :size="20" /></VarButton
          ></template>
        </VarInput>
      </div>
      <div v-if="model.operation === 'replace'" class="admin-actions">
        <VarButton text @click="cancel">{{ configured ? '取消编辑' : '取消输入' }}</VarButton
        ><small class="admin-note">保存后生效；仅能查看本次输入的新值。</small>
      </div>
    </template>
    <div v-if="model.operation === 'clear'" class="source-secret-summary" role="status">
      <span>{{ label }} · 保存后清除</span><VarButton text @click="cancel">撤销删除</VarButton>
    </div>
    <AdminSourceDialog
      v-model:show="clearing"
      :title="`清除${label}？`"
      confirm="确认清除"
      danger
      @confirm="clear"
      ><p>
        清除的是此来源保存的凭据，数据源和历史记录会保留。全局保存前可以撤销。
      </p></AdminSourceDialog
    >
  </div>
</template>
