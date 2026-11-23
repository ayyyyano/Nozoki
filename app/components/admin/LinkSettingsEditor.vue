<script setup lang="ts">
import type { ConfigWrite } from '../../../shared/contracts/config'
import { moveOrderedItem } from './move-ordered-item'
const props = defineProps<{
  resetToken: number
  locateToken: number
  locateIndex?: number
  locateField?: string
}>()
const dialog = useTemplateRef('dialog')
const items = defineModel<ConfigWrite['links']>({ required: true })
const { index, draft, show, open, edit, apply, remove } = useOrderedItemEditor(items)
const order = computed(() => (index.value ?? items.value.length) + 1)
function linkSummary(url: string) {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}
function addLink() {
  if (items.value.length >= 4) return
  open({
    id: 'link-' + crypto.randomUUID().slice(0, 8),
    title: '新链接',
    url: 'https://example.com/',
    icon: 'link',
    sortOrder: items.value.length,
    visibility: 'public',
    enabled: true,
  })
}
watch(
  () => props.resetToken,
  () => (show.value = false),
)
watch(
  () => props.locateToken,
  async () => {
    if (props.locateIndex === undefined) return
    edit(props.locateIndex)
    await nextTick()
    await nextTick()
    dialog.value?.focusValidation(props.locateField)
  },
)
</script>

<template>
  <section class="admin-module-group">
    <h3>首页展示</h3>
    <TransitionGroup
      tag="ul"
      move-class="admin-order-move"
      class="admin-home-items"
      aria-label="常用链接"
    >
      <AdminHomeOrderRow
        v-for="(link, i) in items"
        :key="link.id"
        v-model:enabled="link.enabled"
        :data-edit-link="link.id"
        :title="link.title"
        :description="linkSummary(link.url)"
        :item-label="`链接 ${i + 1}`"
        :enabled-label="`启用链接 ${i + 1}`"
        :index="i"
        :count="items.length"
        @edit="edit(i)"
        @move="moveOrderedItem(items, i, $event)"
      />
    </TransitionGroup>
    <VarButton
      class="admin-add-button"
      type="primary"
      tonal
      :disabled="items.length >= 4"
      @click="addLink"
    >
      <CommonAppIcon name="AddRound" :size="20" />添加链接
    </VarButton>
    <AdminSourceDialog
      ref="dialog"
      v-model:show="show"
      :title="index === null ? '添加链接' : '编辑链接'"
      confirm="应用"
      @confirm="apply"
    >
      <template #headerActions>
        <VarButton
          v-if="index !== null"
          text
          round
          type="danger"
          aria-label="删除链接"
          title="删除链接"
          @click="remove"
        >
          <CommonAppIcon name="DeleteRound" :size="20" />
        </VarButton>
      </template>
      <div v-if="draft" class="source-candidate-fields">
        <AdminText v-model="draft.title" data-error-field="title" :label="`链接 ${order} 名称`" />
        <AdminText v-model="draft.url" data-error-field="url" :label="`链接 ${order} URL`" />
        <AdminLinkIconInput
          v-model="draft.icon"
          data-error-field="icon"
          :label="`链接 ${order} 图标`"
        />
        <VarSelect
          v-model="draft.visibility"
          data-error-field="visibility"
          :aria-label="`链接 ${order} 权限`"
          placeholder="条目权限"
          variant="outlined"
        >
          <VarOption label="公开" value="public" />
          <VarOption label="管理员" value="admin" />
        </VarSelect>
      </div>
    </AdminSourceDialog>
  </section>
</template>
