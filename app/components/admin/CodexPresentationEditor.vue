<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import {
  CODEX_RINGS,
  DEFAULT_CODEX_GUEST,
  DEFAULT_CODEX_SLOTS,
  RING_LABELS,
  type CodexRingId,
  type DisplayPolicy,
} from '../../../shared/domain/codex-rings'
const model = defineModel<ModuleSettings>({ required: true })
const visibility = { full: '完整显示', masked: '遮蔽', hidden: '隐藏' } as const
const codex = computed(() => model.value.presentation?.codex)
const slots = computed(() => codex.value?.slots ?? DEFAULT_CODEX_SLOTS)
function setSlot(index: 0 | 1, id: CodexRingId) {
  if (!CODEX_RINGS.includes(id) || slots.value[1 - index] === id) return
  const next: [CodexRingId, CodexRingId] = [...slots.value]
  next[index] = id
  model.value.presentation = {
    codex: { slots: next, guest: { ...DEFAULT_CODEX_GUEST, ...codex.value?.guest } },
  }
}
function setRingPolicy(id: CodexRingId, policy: DisplayPolicy) {
  model.value.presentation = {
    codex: {
      slots: [...slots.value],
      guest: { ...DEFAULT_CODEX_GUEST, ...codex.value?.guest, [id]: policy },
    },
  }
}
const props = defineProps<{ section: 'home' | 'guest' }>()
</script>
<template>
  <div v-if="props.section === 'home'" class="admin-fields">
    <VarSelect
      v-for="index in [0, 1] as const"
      :key="index"
      :model-value="slots[index]"
      :aria-label="index === 0 ? 'Codex 左侧圆环' : 'Codex 右侧圆环'"
      :placeholder="index === 0 ? '左侧圆环' : '右侧圆环'"
      variant="outlined"
      @update:model-value="(value) => setSlot(index, value)"
    >
      <VarOption
        v-for="id in CODEX_RINGS"
        :key="id"
        :label="RING_LABELS[id]"
        :value="id"
        :disabled="slots[1 - index] === id"
      />
    </VarSelect>
  </div>
  <div v-else class="admin-fields">
    <VarSelect
      v-for="id in CODEX_RINGS"
      :key="id"
      :model-value="codex?.guest[id] ?? DEFAULT_CODEX_GUEST[id]"
      :aria-label="`访客：${RING_LABELS[id]}`"
      :placeholder="`访客：${RING_LABELS[id]}`"
      variant="outlined"
      @update:model-value="(value) => setRingPolicy(id, value)"
    >
      <VarOption v-for="(label, value) in visibility" :key="value" :label="label" :value="value" />
    </VarSelect>
  </div>

  <p v-if="props.section === 'guest'" class="admin-note">
    访客设置仅在模块公开时生效，并受字段权限限制。
  </p>
</template>
