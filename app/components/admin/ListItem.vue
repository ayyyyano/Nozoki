<script setup lang="ts">
defineProps<{ title: string; icon: string; description: string; editLabel: string }>()
defineEmits<{ edit: [] }>()
</script>

<template>
  <section class="admin-item admin-list-item">
    <header>
      <button
        class="admin-item-toggle"
        type="button"
        aria-haspopup="dialog"
        :aria-label="editLabel"
        @click="$emit('edit')"
      >
        <CommonAppIcon :name="icon" :size="24" />
        <span class="admin-item-copy">
          <strong>{{ title }}</strong>
          <small>{{ description }}</small>
        </span>
        <CommonAppIcon name="arrow" :size="20" class="admin-item-chevron" />
      </button>
      <div class="admin-item-actions"><slot /></div>
    </header>
  </section>
</template>
