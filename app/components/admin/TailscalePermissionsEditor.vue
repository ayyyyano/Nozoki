<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import type { DisplayPolicy } from '../../../shared/domain/codex-rings'
const model = defineModel<ModuleSettings>({ required: true })
const visibility = { full: '完整显示', masked: '遮蔽', hidden: '隐藏' } as const
const tailnetIp = computed(() =>
  model.value.ipVisibility === 'hidden'
    ? 'all-hidden'
    : (model.value.presentation?.tailnetIp ??
      (model.value.ipVisibility === 'public' ? 'full' : 'masked')),
)
function setTailnetIp(policy: DisplayPolicy | 'all-hidden') {
  model.value.ipVisibility = policy === 'all-hidden' ? 'hidden' : 'admin'
  model.value.presentation = {
    ...model.value.presentation,
    tailnetIp: policy === 'all-hidden' ? 'hidden' : policy,
  }
}
</script>
<template>
  <div class="admin-fields">
    <VarSelect
      :model-value="model.presentation?.tailnetName ?? 'full'"
      aria-label="Tailscale 访客节点名称"
      placeholder="访客节点名称"
      variant="outlined"
      @update:model-value="
        (value) => (model.presentation = { ...model.presentation, tailnetName: value })
      "
    >
      <VarOption v-for="(label, value) in visibility" :key="value" :label="label" :value="value" />
    </VarSelect>
    <VarSelect
      :model-value="tailnetIp"
      aria-label="Tailscale IP 显示"
      placeholder="访客 IP 显示"
      variant="outlined"
      @update:model-value="setTailnetIp"
    >
      <VarOption label="显示" value="full" />
      <VarOption label="登录后显示（访客遮蔽）" value="masked" />
      <VarOption label="访客隐藏" value="hidden" />
      <VarOption label="所有人隐藏" value="all-hidden" />
    </VarSelect>
  </div>
  <p class="admin-note">访客设置仅在模块公开时生效，并受字段权限限制。</p>
</template>
