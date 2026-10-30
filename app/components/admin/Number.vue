<script setup lang="ts">
const model = defineModel<number>({ required: true })
defineProps<{ label: string }>()
const text = computed({
  get: () => String(model.value),
  set: (v) => {
    if (/^\d+$/.test(v)) model.value = Number(v)
  },
})
</script>
<template>
  <VarInput
    v-model="text"
    :placeholder="label"
    :aria-label="label"
    inputmode="numeric"
    variant="outlined"
  />
</template>
