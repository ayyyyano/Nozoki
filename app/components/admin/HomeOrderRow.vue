<script setup lang="ts">
import { preserveAdminOrderFocus } from '../../utils/admin-order-focus'
const enabled = defineModel<boolean>('enabled', { required: true })
defineProps<{
  title: string
  description: string
  enabledLabel: string
  itemLabel: string
  index: number
  count: number
}>()
const emit = defineEmits<{ edit: []; move: [delta: -1 | 1] }>()
</script>

<template>
  <li>
    <label class="home-item-choice">
      <input v-model="enabled" type="checkbox" :aria-label="enabledLabel" />
      <span class="home-item-label">
        <strong :title="title">{{ title }}</strong>
        <small :title="description">{{ description }}</small>
      </span>
    </label>
    <VarButton
      text
      round
      type="primary"
      :aria-label="`编辑${itemLabel}`"
      data-order-edit
      aria-haspopup="dialog"
      @click="$emit('edit')"
      ><CommonAppIcon name="EditRound" :size="20"
    /></VarButton>
    <VarButton
      text
      round
      :disabled="index === 0"
      :aria-label="`上移${itemLabel}`"
      @click="preserveAdminOrderFocus($event, () => emit('move', -1))"
      ><CommonAppIcon name="up" :size="20"
    /></VarButton>
    <VarButton
      text
      round
      :disabled="index === count - 1"
      :aria-label="`下移${itemLabel}`"
      @click="preserveAdminOrderFocus($event, () => emit('move', 1))"
      ><CommonAppIcon name="down" :size="20"
    /></VarButton>
  </li>
</template>
