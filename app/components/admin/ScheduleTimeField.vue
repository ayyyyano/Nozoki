<script setup lang="ts">
const model = defineModel<string>({ required: true })
defineProps<{ label: string }>()
</script>

<template>
  <label class="schedule-native-field">
    {{ label }}
    <input v-model="model" type="time" :aria-label="`${label} HH:mm`" />
  </label>
</template>
