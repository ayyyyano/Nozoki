<script setup lang="ts">
import type { ModuleId } from '../../../shared/contracts/dashboard'
const show = defineModel<boolean>('show', { required: true })
defineProps<{ title: string; moduleId?: ModuleId }>()
const titleId = useId(),
  subtitleId = useId(),
  panel = useTemplateRef<HTMLElement>('panel')
const focus = useModalFocus(show, panel)
const escapeHandlers = new Set<() => boolean>()
provide('dashboard-detail-escape', escapeHandlers)
function onEscape() {
  let handled = false
  for (const clear of escapeHandlers) if (clear()) handled = true
  if (!handled) show.value = false
}
</script>
<template>
  <VarPopup
    v-model:show="show"
    position="center"
    transition="module-detail"
    overlay-class="module-detail-overlay"
    :default-style="false"
    :close-on-key-escape="moduleId !== 'services'"
    :aria-labelledby="titleId"
    :aria-describedby="$slots.subtitle ? subtitleId : undefined"
    @key-escape="moduleId === 'services' && onEscape()"
    @closed="focus.restoreFocus"
  >
    <section
      ref="panel"
      class="module-detail-panel"
      :data-module-detail="moduleId"
      tabindex="-1"
      @keydown.esc.stop="onEscape"
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
