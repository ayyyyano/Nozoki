<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'

const model = defineModel<ModuleSettings>({ required: true })
const stateRule = computed(() => (model.value.fields['/stateText'] ? '/stateText' : 'stateText'))
const policy = computed(() => model.value.fields[stateRule.value])
const privateStatus = computed({
  get: () =>
    model.value.visibility === 'admin' ||
    policy.value?.visibility === 'admin' ||
    policy.value?.enabled === false,
  set: (restricted: boolean) => {
    if (restricted) model.value.fields[stateRule.value] = { enabled: true, visibility: 'admin' }
    else delete model.value.fields[stateRule.value]
  },
})
</script>

<template>
  <AdminSettingSwitch
    v-model="privateStatus"
    :disabled="model.visibility === 'admin' || policy?.enabled === false"
    label="访客隐藏设备应用与状态"
  />
</template>
