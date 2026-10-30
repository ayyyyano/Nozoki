<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import { fieldChoices, fieldPointer, parseFieldPath } from '../../../shared/contracts/field-paths'
const model = defineModel<ModuleSettings>({ required: true })
const choices = computed(() => fieldChoices(model.value.id))
const selected = ref(''),
  selectors = ref<Record<number, string>>({}),
  error = ref('')
const choice = computed(() => choices.value.find((c) => fieldPointer(c.path) === selected.value))
function add() {
  if (!choice.value) return
  const parts = [...choice.value.path]
  for (const i of choice.value.ids) if (selectors.value[i]) parts[i] = '@' + selectors.value[i]
  for (const i of choice.value.dates) if (selectors.value[i]) parts[i] = selectors.value[i]!
  const pointer = fieldPointer(parts)
  if (!parseFieldPath(model.value.id, pointer)) {
    error.value = '字段或项目 ID 无效'
    return
  }
  model.value.fields[pointer] = { enabled: true, visibility: 'admin' }
  error.value = ''
}
function display(path: string) {
  const parts = parseFieldPath(model.value.id, path)
  return parts ? fieldPointer(parts) : '无效旧规则：' + path
}
</script>
<template>
  <details class="admin-details">
    <summary>字段权限（{{ Object.keys(model.fields).length }}）</summary>
    <p class="admin-note">
      字段仅能收紧模块权限。* 匹配全部项目；指定 ID 会自动编码，不填写表示通配。行情显示名称为
      name。
    </p>
    <div v-for="(policy, path) in model.fields" :key="path" class="admin-rule">
      <code>{{ display(String(path)) }}</code>
      <label><VarSwitch v-model="policy.enabled" :aria-label="`字段 ${path} 启用`" />启用</label>
      <VarSelect
        v-model="policy.visibility"
        :aria-label="`字段 ${path} 权限`"
        :disabled="model.visibility === 'admin'"
        variant="outlined"
        ><VarOption label="管理员" value="admin" /><VarOption label="公开" value="public"
      /></VarSelect>
      <VarButton text @click="delete model.fields[path]" :aria-label="`移除字段 ${path}`"
        >移除</VarButton
      >
    </div>
    <VarSelect
      v-model="selected"
      aria-label="添加字段规则"
      placeholder="选择实际 DTO 字段"
      variant="outlined"
      @update:model-value="selectors = {}"
      ><VarOption
        v-for="c in choices"
        :key="fieldPointer(c.path)"
        :label="fieldPointer(c.path)"
        :value="fieldPointer(c.path)"
    /></VarSelect>
    <AdminText
      v-for="i in choice?.ids ?? []"
      :key="i"
      v-model="selectors[i]!"
      :label="`第 ${i + 1} 段项目 ID（留空为全部）`"
    />
    <AdminText
      v-for="i in choice?.dates ?? []"
      :key="`date-${i}`"
      v-model="selectors[i]!"
      :label="`第 ${i + 1} 段日期（YYYY-MM-DD，留空为全部）`"
      :max="10"
    />
    <VarButton text :disabled="!choice" @click="add">添加权限规则</VarButton>
    <p v-if="error" role="alert">{{ error }}</p>
  </details>
</template>
