<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import type { ModuleId } from '../../../shared/contracts/dashboard'
import { MODULE_ICONS } from '../../../shared/icons/modules'

defineProps<{ modules: ModuleSettings[]; readOnly: boolean }>()
defineEmits<{ edit: [id: ModuleId] }>()
</script>

<template>
  <div class="admin-record-list">
    <p v-if="!modules.length" class="admin-note">暂无模块。</p>
    <AdminListItem
      v-for="module in modules"
      :key="module.id"
      :data-edit-module="module.id"
      :title="module.title"
      :icon="MODULE_ICONS[module.id]"
      :edit-label="`编辑 ${module.title}（${module.id}）`"
      :description="`${module.id} · ${module.visibility === 'public' ? '公开' : '管理员'}`"
      @edit="$emit('edit', module.id)"
    >
      <VarSwitch v-model="module.enabled" :disabled="readOnly" :aria-label="`启用 ${module.id}`" />
    </AdminListItem>
  </div>
</template>
