<script setup lang="ts">
const show = defineModel<boolean>('show', { required: true })
defineProps<{
  title: string
  confirm?: string
  danger?: boolean
  busy?: boolean
  blocked?: boolean
}>()
const emit = defineEmits<{ confirm: []; closed: [] }>()
const titleId = useId(),
  panel = useTemplateRef<HTMLElement>('panel')
const focus = useModalFocus(show, panel)
function closed() {
  focus.restoreFocus()
  emit('closed')
}
</script>
<template>
  <VarPopup
    v-model:show="show"
    position="center"
    :default-style="false"
    :close-on-key-escape="!busy"
    :close-on-click-overlay="!busy"
    @closed="closed"
  >
    <section
      ref="panel"
      class="admin-confirm source-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      @keydown.esc="!busy && (show = false)"
    >
      <header class="source-dialog-heading">
        <h2 :id="titleId">{{ title }}</h2>
        <VarButton
          text
          round
          class="edge-icon-action edge-icon-action--small"
          :disabled="busy"
          aria-label="关闭对话框"
          @click="show = false"
          ><CommonAppIcon name="close" :size="20"
        /></VarButton>
      </header>
      <slot />
      <div v-if="confirm" class="admin-actions source-dialog-actions">
        <VarButton text :disabled="busy" @click="show = false">取消</VarButton
        ><VarButton
          :type="danger ? 'danger' : 'primary'"
          tonal
          :disabled="blocked || busy"
          :loading="busy"
          @click="$emit('confirm')"
          >{{ confirm }}</VarButton
        >
      </div>
    </section>
  </VarPopup>
</template>
