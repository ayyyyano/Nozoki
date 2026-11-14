<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
const model = defineModel<ModuleSettings>({ required: true })

function makePrivate() {
  if (model.value.visibility === 'admin')
    for (const policy of Object.values(model.value.fields)) policy.visibility = 'admin'
}
</script>

<template>
  <section class="admin-module-group">
    <h3>基础设置</h3>
    <AdminText v-model="model.title" :label="`${model.id} 标题`" :max="100" />
    <slot name="source" />
  </section>
  <slot name="presentation" />
  <section class="admin-module-group">
    <h3>访客权限</h3>
    <div class="admin-fields">
      <VarSelect
        v-model="model.visibility"
        :aria-label="`${model.id} 模块权限`"
        placeholder="模块权限"
        variant="outlined"
        @update:model-value="makePrivate"
      >
        <VarOption label="公开" value="public" />
        <VarOption label="管理员" value="admin" />
      </VarSelect>
      <VarSelect
        v-model="model.guestBehavior"
        :aria-label="`${model.id} 访客行为`"
        placeholder="访客行为"
        variant="outlined"
      >
        <VarOption label="隐藏" value="hidden" />
        <VarOption label="登录提示" value="login_hint" />
      </VarSelect>
    </div>
    <slot name="guest" />
  </section>
  <AdminFieldEditor v-model="model" />
</template>
