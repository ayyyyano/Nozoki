<script setup lang="ts">
const section = defineModel<string>({ required: true })
defineProps<{ sections: readonly { id: string; label: string; icon: string }[] }>()
const show = ref(false)
const panel = useTemplateRef<HTMLElement>('panel')
const focus = useModalFocus(show, panel)
defineExpose({ open: () => (show.value = true), show })
function choose(id: string) {
  section.value = id
  show.value = false
}
let desktop: MediaQueryList | undefined
function closeOnDesktop() {
  if (desktop?.matches) show.value = false
}
onMounted(() => {
  desktop = window.matchMedia('(min-width: 901px)')
  desktop.addEventListener('change', closeOnDesktop)
})
onBeforeUnmount(() => desktop?.removeEventListener('change', closeOnDesktop))
</script>
<template>
  <nav class="admin-nav" aria-label="管理分区">
    <div class="admin-nav-list">
      <VarButton
        v-for="item in sections"
        :key="item.id"
        text
        :class="{ 'admin-nav-active': section === item.id }"
        :aria-current="section === item.id ? 'page' : undefined"
        @click="choose(item.id)"
      >
        <CommonAppIcon :name="item.icon" :size="22" />{{ item.label }}
      </VarButton>
    </div>
  </nav>
  <VarPopup
    v-model:show="show"
    position="left"
    :default-style="false"
    :close-on-key-escape="true"
    @closed="focus.restoreFocus"
  >
    <section
      ref="panel"
      class="admin-drawer admin-section-menu"
      role="dialog"
      aria-modal="true"
      aria-label="选择管理分区"
      tabindex="-1"
    >
      <VarButton
        v-for="item in sections"
        :key="item.id"
        text
        :class="{ 'admin-nav-active': section === item.id }"
        :aria-current="section === item.id ? 'page' : undefined"
        @click="choose(item.id)"
      >
        <CommonAppIcon :name="item.icon" :size="22" />{{ item.label }}
      </VarButton>
    </section>
  </VarPopup>
</template>
