<script setup lang="ts">
defineProps<{ title: string; description?: string; icon?: string; status?: string }>()
const open = defineModel<boolean>('open', { default: false })
const id = useId()
</script>
<template>
  <section class="admin-item admin-editor-item">
    <header>
      <div
        class="admin-item-title"
        :class="{ 'admin-item-title--with-action': $slots.beforeToggle }"
      >
        <button
          class="admin-item-toggle"
          type="button"
          :aria-expanded="open"
          :aria-controls="id"
          @click="open = !open"
        >
          <CommonAppIcon :name="icon ?? 'tune'" :size="24" />
          <span class="admin-item-copy"
            ><strong>{{ title }}</strong
            ><small v-if="description">{{ description }}</small></span
          >
          <span v-if="status" class="admin-item-status">{{ status }}</span>
          <CommonAppIcon
            name="arrow"
            :size="20"
            class="admin-item-chevron"
            :class="{ 'admin-chevron-open': open }"
          />
        </button>
        <div v-if="$slots.beforeToggle" class="admin-item-title-action">
          <slot name="beforeToggle" />
        </div>
      </div>
      <div v-if="$slots.actions" class="admin-item-actions"><slot name="actions" /></div>
    </header>
    <div v-show="open" :id="id" class="admin-item-body"><slot /></div>
  </section>
</template>
