<script setup lang="ts">
import type { ModuleSettings } from '../../../shared/contracts/config'
import type { ModulePresentation } from '../../../shared/contracts/module-presentation'
import type { DataStatus } from '../../../shared/contracts/dashboard'
import {
  DEVICE_ICONS,
  ITEM_ALIAS_LIMIT,
  ITEM_HOME_LIMITS,
  hasAddressText,
  itemKey,
  validDisplayAlias,
  type DeviceIcon,
  type ItemChoice,
  type ItemDisplayModule,
  type ItemRef,
} from '../../../shared/domain/item-display'

const model = defineModel<ModuleSettings>({ required: true })
const props = defineProps<{ kind: ItemDisplayModule }>()
const limit = ITEM_HOME_LIMITS[props.kind]
const itemLabel = { devices: '设备', tailscale: '节点', services: '服务' }[props.kind]
const iconLabels = ['通用设备', '手机', '平板', '笔记本', '台式机', '显示器', '手表']
const presentation = computed(() => model.value.presentation ?? {})
const itemRequestKey = `admin-display-items-${props.kind}`
const { data, status, error, refresh, clear } = useFetch<{
  items: ItemChoice[]
  status: DataStatus
}>(`/api/admin/display-items/${props.kind}`, {
  key: itemRequestKey,
  server: false,
  immediate: false,
})
onMounted(() => void refresh())
onBeforeUnmount(() => {
  clear()
  clearNuxtData(itemRequestKey)
})
const sourceIds = computed(
  () => new Set(Object.values(model.value.sources).map((ref) => ref.sourceId)),
)
const available = computed(
  () =>
    new Map(
      (data.value?.items ?? [])
        .filter((item) => sourceIds.value.has(item.sourceId))
        .map((item) => [itemKey(item), item] as const),
    ),
)
const selection = computed<ItemRef[] | undefined>(() => {
  if (props.kind === 'devices') return presentation.value.deviceHome
  if (props.kind === 'tailscale') return presentation.value.tailnetHome
  return model.value.homeServices?.map(({ sourceId, monitorId }) => ({
    sourceId,
    itemId: monitorId,
  }))
})
type Override = ItemRef & { alias?: string; icon?: DeviceIcon }
const overrides = computed<Override[]>(() => {
  if (props.kind === 'devices') return presentation.value.deviceOverrides ?? []
  if (props.kind === 'tailscale') return presentation.value.tailnetAliases ?? []
  return presentation.value.serviceAliases ?? []
})
const refOnly = ({ sourceId, itemId }: ItemRef): ItemRef => ({ sourceId, itemId })
const selected = computed(
  () => selection.value ?? [...available.value.values()].slice(0, limit).map(refOnly),
)
const rows = computed(() => {
  const overridesByKey = new Map(overrides.value.map((item) => [itemKey(item), item]))
  const indexes = new Map(selected.value.map((item, index) => [itemKey(item), index]))
  const ordered = new Map<string, ItemRef>()
  for (const item of [...selected.value, ...available.value.values(), ...overrides.value])
    ordered.set(itemKey(item), item)
  return [...ordered].map(([key, item]) => ({
    ...refOnly(item),
    key,
    index: indexes.get(key) ?? -1,
    discovered: available.value.has(key),
    name: available.value.get(key)?.name ?? item.itemId,
    alias: overridesByKey.get(key)?.alias,
    icon: overridesByKey.get(key)?.icon,
  }))
})
const missing = computed(
  () => selected.value.filter((item) => !available.value.has(itemKey(item))).length,
)

function patch(values: Partial<ModulePresentation>) {
  const next = { ...presentation.value, ...values }
  for (const key of Object.keys(next) as (keyof ModulePresentation)[])
    if (next[key] === undefined) delete next[key]
  if (Object.keys(next).length) model.value.presentation = next
  else delete model.value.presentation
}
function setSelection(value?: ItemRef[]) {
  if (props.kind === 'devices') patch({ deviceHome: value })
  else if (props.kind === 'tailscale') patch({ tailnetHome: value })
  else if (value)
    model.value.homeServices = value.map(({ sourceId, itemId }) => ({
      sourceId,
      monitorId: itemId,
    }))
  else delete model.value.homeServices
}
function toggle(item: ItemRef, checked: boolean) {
  const next = selected.value.filter((current) => itemKey(item) !== itemKey(current))
  if (checked && next.length < limit) next.push(refOnly(item))
  setSelection(next)
}
function move(index: number, offset: number) {
  const next = selected.value.slice()
  const target = index + offset
  if (index < 0 || target < 0 || target >= next.length) return
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item!)
  setSelection(next)
}

const editing = ref<ItemRef>()
const show = ref(false)
const alias = ref('')
const icon = ref<DeviceIcon | 'auto'>('auto')
const aliasError = computed(() => {
  if (alias.value && !validDisplayAlias(alias.value))
    return '别名不能只含空白，也不能包含控制字符。'
  if (props.kind === 'tailscale' && hasAddressText(alias.value)) return '节点别名不能包含 IP 地址。'
  return ''
})
const editName = computed(
  () =>
    rows.value.find((row) => editing.value && itemKey(editing.value) === row.key)?.name ??
    itemLabel,
)
function edit(row: (typeof rows.value)[number]) {
  editing.value = refOnly(row)
  alias.value = row.alias ?? ''
  icon.value = row.icon ?? 'auto'
  show.value = true
}
function apply() {
  if (!editing.value || aliasError.value) return
  const item = editing.value
  if (props.kind === 'devices') {
    const next = (presentation.value.deviceOverrides ?? []).filter(
      (rule) => itemKey(rule) !== itemKey(item),
    )
    if (alias.value || icon.value !== 'auto')
      next.push({
        ...item,
        ...(alias.value ? { alias: alias.value.trim() } : {}),
        ...(icon.value !== 'auto' ? { icon: icon.value } : {}),
      })
    patch({ deviceOverrides: next.length ? next : undefined })
  } else {
    const field = props.kind === 'services' ? 'serviceAliases' : 'tailnetAliases'
    const next = (presentation.value[field] ?? []).filter((rule) => itemKey(rule) !== itemKey(item))
    if (alias.value) next.push({ ...item, alias: alias.value.trim() })
    patch({ [field]: next.length ? next : undefined })
  }
  show.value = false
}
</script>

<template>
  <div class="home-items-editor">
    <p class="admin-note">
      {{ selected.length - missing }} / {{ limit }} 项首页{{ itemLabel }} ·
      {{ selection === undefined ? '自动选择' : '自定义顺序' }}
      <template v-if="missing"> · {{ missing }} 项选择当前未发现</template>
    </p>
    <p v-if="status === 'pending'" role="status">正在读取已采集列表…</p>
    <p v-else-if="error" role="alert">无法读取列表。已保存的配置仍可编辑。</p>
    <p
      v-else-if="data?.status === 'stale' || data?.status === 'offline' || data?.status === 'error'"
      class="admin-note"
    >
      来源近期未成功更新，列表可能来自上次采集。
    </p>
    <p v-else-if="!available.size" class="admin-note">当前快照没有可选{{ itemLabel }}。</p>
    <p v-if="selected.length === limit" class="admin-note">
      已达到选择上限。取消一项选择后可以添加其他{{ itemLabel }}。
    </p>
    <ul v-if="rows.length" class="admin-home-items" :aria-label="`首页${itemLabel}列表`">
      <li
        v-for="row in rows"
        :key="row.key"
        :data-item-id="row.itemId"
        :data-selected="row.index >= 0"
      >
        <input
          type="checkbox"
          :aria-label="`在首页显示 ${row.alias ?? row.name}`"
          :checked="row.index >= 0"
          :disabled="row.index < 0 && (!row.discovered || selected.length >= limit)"
          @change="toggle(row, ($event.target as HTMLInputElement).checked)"
        />
        <span class="home-item-label">
          <strong :title="row.alias ?? row.name">{{ row.alias ?? row.name }}</strong>
          <small :title="`${row.sourceId} · ${row.itemId}`">
            {{ row.sourceId }} · {{ row.itemId }}
          </small>
          <small v-if="!row.discovered">{{
            sourceIds.has(row.sourceId) ? '当前未发现' : '当前未绑定此来源'
          }}</small>
        </span>
        <VarButton
          text
          round
          type="primary"
          :aria-label="`编辑 ${row.alias ?? row.name}`"
          aria-haspopup="dialog"
          @click="edit(row)"
        >
          <CommonAppIcon name="EditRound" :size="20" />
        </VarButton>
        <VarButton
          v-if="row.index >= 0"
          text
          round
          :disabled="row.index === 0"
          :aria-label="`上移${itemLabel} ${row.alias ?? row.name}`"
          @click="move(row.index, -1)"
          ><CommonAppIcon name="up" :size="20"
        /></VarButton>
        <VarButton
          v-if="row.index >= 0"
          text
          round
          :disabled="row.index === selected.length - 1"
          :aria-label="`下移${itemLabel} ${row.alias ?? row.name}`"
          @click="move(row.index, 1)"
          ><CommonAppIcon name="down" :size="20"
        /></VarButton>
      </li>
    </ul>
    <div class="admin-actions">
      <VarButton tonal @click="refresh()">刷新列表</VarButton>
      <VarButton v-if="selection === undefined || selected.length" text @click="setSelection([])"
        >清空首页选择</VarButton
      >
      <VarButton v-if="selection !== undefined" text @click="setSelection()"
        >恢复自动选择</VarButton
      >
    </div>
    <AdminSourceDialog
      v-model:show="show"
      title="编辑展示"
      confirm="应用"
      :blocked="!!aliasError"
      @confirm="apply"
    >
      <p class="admin-note item-source-name">{{ editName }}</p>
      <AdminText v-model="alias" label="显示别名（留空使用来源名称）" :max="ITEM_ALIAS_LIMIT" />
      <p v-if="aliasError" role="alert">{{ aliasError }}</p>
      <VarSelect
        v-if="kind === 'devices'"
        v-model="icon"
        aria-label="设备图标"
        placeholder="设备图标"
        variant="outlined"
      >
        <VarOption label="自动图标" value="auto" />
        <VarOption
          v-for="(value, index) in DEVICE_ICONS"
          :key="value"
          :label="iconLabels[index]"
          :value="value"
        />
      </VarSelect>
    </AdminSourceDialog>
  </div>
</template>
