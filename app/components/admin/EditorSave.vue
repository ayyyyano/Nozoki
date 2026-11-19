<script setup lang="ts">
defineProps<{
  errors: string[]
  busy: boolean
  blocked: boolean
  reload: boolean
  dirty: boolean
}>()
defineEmits<{ save: []; reload: []; locate: [error: string] }>()
</script>

<template>
  <div v-show="dirty || errors.length" class="admin-editor-save-state" tabindex="-1" role="status">
    {{ dirty ? '未保存修改' : '' }}
    <ul v-if="errors.length">
      <li v-for="error in errors" :key="error">
        <button type="button" class="admin-error-link" @click="$emit('locate', error)">
          {{ error }}
        </button>
      </li>
    </ul>
  </div>
  <VarButton v-if="reload" class="admin-editor-reload" text @click="$emit('reload')"
    >读取服务器最新配置</VarButton
  >
  <VarButton
    class="admin-editor-save-button"
    type="primary"
    :loading="busy"
    :disabled="busy || blocked"
    @click="$emit('save')"
  >
    <CommonAppIcon name="save" :size="20" />保存配置
  </VarButton>
</template>
