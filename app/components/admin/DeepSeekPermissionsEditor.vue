<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
const model = defineModel<ModuleSettings>({ required: true })
</script>

<template>
  <label>
    <VarSwitch v-model="model.guestBlur" aria-label="DeepSeek 未登录时模糊展示" />
    未登录时模糊展示余额（保留卡片）
  </label>
</template>
