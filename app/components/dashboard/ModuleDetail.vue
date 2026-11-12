<script setup lang="ts">
const show = defineModel<boolean>('show', { required: true })
defineProps<{ title: string }>()
const titleId = useId(),
  subtitleId = useId(),
  panel = useTemplateRef<HTMLElement>('panel')
const focus = useModalFocus(show, panel)
</script>
<template>
  <VarPopup
    v-model:show="show"
    position="right"
    :default-style="false"
    :close-on-key-escape="true"
    @closed="focus.restoreFocus"
  >
    <section
      ref="panel"
      class="module-detail-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="$slots.subtitle ? subtitleId : undefined"
      tabindex="-1"
      @keydown.esc.stop="show = false"
    >
      <header class="module-detail-heading">
        <div class="module-detail-title">
          <h2 :id="titleId">{{ title }}</h2>
          <div v-if="$slots.subtitle" :id="subtitleId" class="module-detail-subtitle">
            <slot name="subtitle" />
          </div>
        </div>
        <VarButton
          text
          round
          class="edge-icon-action"
          aria-label="关闭详情"
          title="关闭详情"
          @click="show = false"
          ><CommonAppIcon name="close"
        /></VarButton>
      </header>
      <div class="module-detail-content"><slot /></div>
    </section>
  </VarPopup>
</template>
