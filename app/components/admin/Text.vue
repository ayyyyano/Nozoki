<script setup lang="ts">
const model = defineModel<string>({ required: true })
const focused = ref(false)
withDefaults(
  defineProps<{
    label: string
    secret?: boolean
    multiline?: boolean
    readonly?: boolean
    max?: number
  }>(),
  { max: 2048 },
)
</script>
<template>
  <VarInput
    v-model="model"
    :placeholder="label"
    :aria-label="label"
    :type="secret ? 'password' : 'text'"
    :textarea="multiline"
    :rows="multiline ? 3 : undefined"
    :readonly="readonly"
    :maxlength="max"
    :prevent-auto-fill="false"
    autocomplete="off"
    variant="outlined"
    class="admin-text"
    :class="{ 'admin-text--count': focused || (model?.length ?? 0) >= max * 0.9 }"
    @focus="focused = true"
    @blur="focused = false"
  />
</template>
<style scoped>
.admin-text {
  position: relative;
}
.admin-text :deep(.var-form-details) {
  position: absolute;
  top: 100%;
  right: 0;
  width: 100%;
  pointer-events: none;
}
.admin-text:not(.admin-text--count) :deep(.var-form-details) {
  display: none;
}
</style>
