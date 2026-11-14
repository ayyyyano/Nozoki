<script setup lang="ts">
import type { ConfigWrite } from '../../../shared/contracts/config'
import { moveOrderedItem } from './move-ordered-item'
const props = defineProps<{ resetToken: number; locateToken: number }>()
const items = defineModel<ConfigWrite['links']>({ required: true })
const expandedLinks = ref<Record<string, boolean>>({})
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
  const id = 'link-' + crypto.randomUUID().slice(0, 8)
  expandedLinks.value[id] = true
  items.value.push({
    id,
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
  () => (expandedLinks.value = {}),
)
watch(
  () => props.locateToken,
  () => {
    expandedLinks.value = Object.fromEntries(items.value.map((item) => [item.id, true]))
  },
)
</script>
<template>
  <section class="admin-module-group">
    <h3>常用链接</h3>
    <AdminEditorItem
      v-for="(l, index) in items"
      :key="l.id"
      v-model:open="expandedLinks[l.id]"
      :title="l.title"
      :description="linkSummary(l.url)"
      :icon="l.icon"
      :data-edit-link="l.id"
      class="admin-link-card"
    >
      <template #actions>
        <VarSwitch
          v-model="l.enabled"
          :aria-label="`启用链接 ${index + 1}`"
          :title="`启用或停用 ${l.title}`"
        />
      </template>
      <div class="admin-fields">
        <AdminText v-model="l.title" :label="`链接 ${index + 1} 名称`" /><AdminText
          v-model="l.url"
          :label="`链接 ${index + 1} URL`"
        /><AdminLinkIconInput v-model="l.icon" :label="`链接 ${index + 1} 图标`" />
        <VarSelect
          v-model="l.visibility"
          :aria-label="`链接 ${index + 1} 权限`"
          placeholder="条目权限"
          variant="outlined"
        >
          <VarOption label="公开" value="public" />
          <VarOption label="管理员" value="admin" />
        </VarSelect>
      </div>
      <div class="admin-actions">
        <VarButton
          text
          round
          :disabled="index === 0"
          :aria-label="`上移链接 ${index + 1}`"
          :title="`上移 ${l.title}`"
          @click="moveOrderedItem(items, index, -1)"
          ><CommonAppIcon name="up" :size="20" /></VarButton
        ><VarButton
          text
          round
          :disabled="index === items.length - 1"
          :aria-label="`下移链接 ${index + 1}`"
          :title="`下移 ${l.title}`"
          @click="moveOrderedItem(items, index, 1)"
          ><CommonAppIcon name="down" :size="20" /></VarButton
        ><VarButton text @click="items.splice(index, 1)">删除链接 {{ index + 1 }}</VarButton>
      </div>
    </AdminEditorItem>
    <VarButton
      class="admin-add-button"
      type="primary"
      tonal
      :disabled="items.length >= 4"
      @click="addLink"
      ><CommonAppIcon name="AddRound" :size="20" />添加链接</VarButton
    >
  </section>
</template>
