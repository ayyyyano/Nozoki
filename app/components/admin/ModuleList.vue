<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import type { ModuleId } from '../../../shared/contracts/dashboard'
import { MODULE_ICONS } from '../../../shared/icons/modules'

defineProps<{ modules: ModuleSettings[]; readOnly: boolean }>()
defineEmits<{ edit: [id: ModuleId] }>()
</script>

<template>
  <div class="admin-module-list">
    <p v-if="!modules.length" class="admin-note">暂无模块。</p>
    <section
      v-for="module in modules"
      :key="module.id"
      class="admin-item"
      :data-edit-module="module.id"
    >
      <header>
        <button
          class="admin-item-toggle"
          type="button"
          :aria-label="`编辑 ${module.title}（${module.id}）`"
          @click="$emit('edit', module.id)"
        >
          <CommonAppIcon :name="MODULE_ICONS[module.id]" :size="24" />
          <span class="admin-item-copy">
            <strong>{{ module.title }}</strong>
            <small>{{ module.id }}</small>
          </span>
          <span class="admin-item-status">{{
            module.visibility === 'public' ? '公开' : '管理员'
          }}</span>
          <CommonAppIcon name="arrow" :size="20" class="admin-item-chevron" />
        </button>
        <div class="admin-item-actions">
          <VarSwitch
            v-model="module.enabled"
            :disabled="readOnly"
            :aria-label="`启用 ${module.id}`"
          />
        </div>
      </header>
    </section>
  </div>
</template>
