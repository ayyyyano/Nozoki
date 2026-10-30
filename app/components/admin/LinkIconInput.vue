<script setup lang="ts">
import { materialIconName } from '../../../shared/icons/material'
const model = defineModel<string>({ required: true })
defineProps<{ label: string }>()
const value = computed({
  get: () => materialIconName(model.value) ?? model.value,
  set: (text: string) => {
    model.value = text.trim()
  },
})
const valid = computed(() => materialIconName(model.value) !== null)
const helpId = useId()
</script>
<template>
  <div class="admin-link-icon-input">
    <VarInput
      v-model="value"
      :placeholder="label"
      :aria-label="label"
      :maxlength="90"
      :aria-describedby="helpId"
      :aria-invalid="!valid"
      variant="outlined"
      autocomplete="off"
      :prevent-auto-fill="false"
    >
      <template #append-icon><CommonAppIcon :name="model" :size="24" /></template>
    </VarInput>
    <p :id="helpId" class="admin-note">
      xicons Material 名称，例如 MenuBookRound、SchoolRound、FavoriteRound。
      <a href="https://www.xicons.org/#/" target="_blank" rel="noopener noreferrer">查看图标名称</a>
    </p>
    <p v-if="!valid" role="alert" class="admin-icon-error">图标名称不存在，请输入有效名称。</p>
  </div>
</template>
