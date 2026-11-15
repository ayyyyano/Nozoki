<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
defineProps<{ label: string; disabled?: boolean }>()
</script>

<template>
  <button
    type="button"
    class="admin-setting-toggle"
    role="switch"
    :aria-checked="model"
    :disabled="disabled"
    @click="model = !model"
  >
    <span>{{ label }}</span>
    <VarSwitch :model-value="model" :disabled="disabled" :tabindex="-1" aria-hidden="true" />
  </button>
</template>
