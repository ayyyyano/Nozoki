<script setup lang="ts">
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{
  title: string
  confirm?: string
  danger?: boolean
  busy?: boolean
  blocked?: boolean
  back?: boolean
}>()
const emit = defineEmits<{ confirm: []; closed: []; back: [] }>()
const titleId = useId(),
  panel = useTemplateRef<HTMLElement>('panel')
const focus = useModalFocus(show, panel)
function dismiss() {
  if (props.busy) return
  if (props.back) emit('back')
  else show.value = false
}
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
    :close-on-key-escape="!busy && !back"
    :close-on-click-overlay="!busy && !back"
    @closed="closed"
  >
    <section
      ref="panel"
      class="admin-confirm source-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      @keydown.esc="dismiss"
    >
      <header class="source-dialog-heading">
        <h2 :id="titleId">{{ title }}</h2>
        <div class="source-dialog-heading-actions">
          <slot name="headerActions" />
          <VarButton
            text
            round
            class="edge-icon-action edge-icon-action--small"
            :disabled="busy"
            :aria-label="back ? '返回来源配置' : '关闭对话框'"
            @click="dismiss"
            ><CommonAppIcon name="close" :size="20"
          /></VarButton>
        </div>
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
