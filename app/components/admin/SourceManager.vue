<script setup lang="ts">
import type { ConfigWrite, IntegrationSettings } from '../../../shared/contracts/config'
import type { ProbeResult } from '../../../shared/contracts/adapter'
import {
  INTEGRATION_PRESETS,
  integrationPreset,
  createIntegrationDraft,
  presetAlreadyAdded,
  sourceReferences,
  type IntegrationDraft,
  type IntegrationPreset,
} from '../../../shared/integration-presets'
import { sourceGuides, type SourceGuide } from './source-guides'
const model = defineModel<IntegrationDraft[]>({ required: true })
const props = defineProps<{
  saved: IntegrationSettings[]
  expectedVersion: number
  modules: ConfigWrite['modules']
  quotes: ConfigWrite['quotes']
  timezone: string
  readOnly: boolean
}>()
const root = useTemplateRef<HTMLElement>('root')
const open = ref<Record<string, boolean>>({}),
  probes = ref<Record<string, ProbeResult | null>>({})
const draftProbes = ref<Record<string, boolean>>({})
function tested(id: string, result: ProbeResult | null, draft = false) {
  probes.value[id] = result
  draftProbes.value[id] = draft
}
const candidate = ref<IntegrationDraft | null>(null)
const adding = ref(false)
const candidateGuideOpen = ref(false)
const savedGuideOpen = ref(false)
const savedGuide = shallowRef<SourceGuide>()
const guideContent = useTemplateRef<HTMLElement>('guideContent')
let guideTrigger: HTMLElement | undefined
function guideFor(source: IntegrationDraft) {
  const id = integrationPreset(source)?.id
  return id === 'deepseek' || id === 'tailscale' || id === 'cliproxy' ? sourceGuides[id] : undefined
}
const candidateGuide = computed(() => candidate.value && guideFor(candidate.value))
async function openCandidateGuide(event: Event) {
  guideTrigger = event.currentTarget as HTMLElement
  candidateGuideOpen.value = true
  await nextTick()
  guideContent.value?.focus()
}
async function closeCandidateGuide() {
  candidateGuideOpen.value = false
  await nextTick()
  guideTrigger?.focus()
  guideTrigger = undefined
}
function openSavedGuide(source: IntegrationDraft) {
  savedGuide.value = guideFor(source)
  savedGuideOpen.value = !!savedGuide.value
}
const clock = useLocalClock()
const canAdd = computed(
  () =>
    !!candidate.value?.connectionProof &&
    Number(candidate.value.connectionProof.split('.')[0]) > clock.value,
)
function addCandidate() {
  if (!candidate.value || !canAdd.value || props.readOnly) return
  const source = candidate.value
  source.enabled = true
  model.value.push(source)
  open.value[source.id] = true
  createdId = source.id
  adding.value = false
  candidate.value = null
}
onBeforeUnmount(() => cancelCandidate())
function candidateClosed() {
  cancelCandidate()
  afterPicker()
}
function cancelCandidate() {
  if (candidate.value) {
    candidate.value.credential = { operation: 'keep' }
    delete candidate.value.identityCredential
  }
  candidate.value = null
  candidateGuideOpen.value = false
  guideTrigger = undefined
}
const picker = ref(false),
  pickerError = ref('')
let createdId = ''
function choose(preset: IntegrationPreset) {
  if (props.readOnly || model.value.length >= 10) return
  try {
    const source = createIntegrationDraft(preset.id, model.value, crypto.randomUUID())
    candidate.value = source
    picker.value = false
    pickerError.value = ''
  } catch {
    pickerError.value = '此类型已添加或暂不可用。'
  }
}
function afterPicker() {
  if (candidate.value && !adding.value) {
    adding.value = true
    return
  }
  if (!createdId) {
    root.value?.querySelector<HTMLButtonElement>('.admin-add-button')?.focus()
    return
  }
  const card = [...(root.value?.querySelectorAll<HTMLElement>('[data-source-id]') ?? [])].find(
    (e) => e.dataset.sourceId === createdId,
  )
  card?.querySelector<HTMLElement>('input,.admin-item-toggle')?.focus()
  createdId = ''
}
function saved(source: IntegrationDraft) {
  return props.saved.find((s) => s.id === source.id)
}
function testSymbols(source: IntegrationDraft) {
  if (source.provider !== 'quotes-custom') return []
  const enabled = props.quotes.filter((q) => q.enabled)
  const bound = enabled.filter((q) => q.provider === source.id)
  const symbols = (bound.length ? bound : enabled)
    .slice(0, 1)
    .map(({ market, symbol }) => ({ market, symbol }))
  return symbols.length ? symbols : [{ market: 'US', symbol: 'QQQM' }]
}
function title(source: IntegrationDraft) {
  return integrationPreset(source)?.name ?? '旧数据源'
}
function hint(source: IntegrationDraft) {
  const p = integrationPreset(source),
    probe = probes.value[source.id]
  if (probe && draftProbes.value[source.id])
    return probe.code
      ? '草稿测试未通过'
      : probe.protocolMatched
        ? '草稿测试通过 · 未保存'
        : '草稿连接尚未确认'
  if (probe)
    return probe.code ? '测试未通过' : probe.protocolMatched ? '连接协议已确认' : '连接尚未确认'
  if (!p) return '旧配置 · 只读'
  if (p.builtin) return '内置 · 无需凭据'
  if (!source.baseUrl) return '待填写实例地址'
  if (source.credential.operation === 'clear') return '凭据待清除 · 未保存'
  if (source.credential.operation === 'replace') return '凭据待更新 · 未保存'
  const needsSecret =
    p.authentication !== 'none' ||
    (source.access?.mode !== 'legacy' && source.access?.authentication === 'bearer')
  if (needsSecret && !saved(source)?.credentialState.configured) return '待配置凭据'
  return p.authentication === 'none' ? '无需凭据 · 未验证' : '已配置 · 未验证'
}
const removing = ref(false),
  removingId = ref(''),
  loading = ref(false),
  removalError = ref('')
const removal = ref<{ protectedHistory: boolean; hasSnapshots: boolean } | null>(null)
const target = computed(() => model.value.find((s) => s.id === removingId.value))
const references = computed(() => sourceReferences(props, removingId.value))
const removalBlocked = computed(
  () => loading.value || !!removalError.value || !!removal.value?.protectedHistory || !target.value,
)
async function requestRemoval(source: IntegrationDraft) {
  removingId.value = source.id
  removal.value = null
  removalError.value = ''
  removing.value = true
  if (!saved(source)) {
    removal.value = { protectedHistory: false, hasSnapshots: false }
    return
  }
  loading.value = true
  try {
    removal.value = await $fetch(
      '/api/admin/integrations/' + encodeURIComponent(source.id) + '/removal',
    )
  } catch {
    removalError.value = '无法确认来源历史状态，请稍后重试。'
  } finally {
    loading.value = false
  }
}
function confirmRemoval() {
  if (props.readOnly || removalBlocked.value) return
  const index = model.value.findIndex((s) => s.id === removingId.value)
  if (index >= 0) {
    model.value[index]!.credential = { operation: 'keep' }
    delete model.value[index]!.identityCredential
    model.value.splice(index, 1)
  }
  removing.value = false
}
function afterRemoval() {
  if (!target.value) root.value?.querySelector<HTMLButtonElement>('.admin-add-button')?.focus()
}
defineExpose({
  expandAll: () => {
    model.value.forEach((s) => {
      open.value[s.id] = true
    })
  },
})
</script>
<template>
  <div ref="root" class="source-manager">
    <AdminEditorItem
      v-for="(source, index) in model"
      :key="source.id"
      v-model:open="open[source.id]"
      class="source-card"
      :data-source-id="source.id"
      :title="title(source)"
      :description="hint(source)"
      :icon="integrationPreset(source)?.icon ?? 'server'"
    >
      <template v-if="guideFor(source)" #beforeToggle>
        <VarButton
          text
          round
          class="source-guide-button"
          aria-haspopup="dialog"
          :aria-label="`查看 ${title(source)} 配置说明`"
          title="配置说明"
          @click="openSavedGuide(source)"
          ><CommonAppIcon name="HelpOutlineRound" :size="20"
        /></VarButton>
      </template>
      <template #actions
        ><div class="source-enable">
          <VarSwitch
            v-model="source.enabled"
            :aria-label="`启用 ${title(source)}`"
            :title="`启用或停用 ${title(source)}`"
          /></div
      ></template>
      <AdminIntegrationEditor
        v-model="model[index]!"
        :timezone="timezone"
        :saved="saved(source)"
        :expected-version="expectedVersion"
        :quote-symbols="testSymbols(source)"
        @tested="(result, draft) => tested(source.id, result, draft)"
      />
      <div class="source-danger-zone">
        <VarButton type="danger" tonal @click="requestRemoval(source)"
          ><CommonAppIcon name="DeleteRound" :size="18" />删除来源</VarButton
        >
      </div>
    </AdminEditorItem>
    <p v-if="!model.length" class="admin-note">尚未添加数据源。选择一种类型开始配置。</p>
    <VarButton
      class="admin-add-button"
      type="primary"
      tonal
      :disabled="readOnly || model.length >= 10"
      @click="picker = true"
      ><CommonAppIcon name="AddRound" :size="20" />添加来源</VarButton
    >
    <AdminSourceDialog v-model:show="picker" title="选择数据源类型" @closed="afterPicker">
      <div class="source-options">
        <button
          v-for="preset in INTEGRATION_PRESETS"
          :key="preset.id"
          type="button"
          class="source-option"
          :disabled="presetAlreadyAdded(preset, model)"
          @click="choose(preset)"
        >
          <CommonAppIcon :name="preset.icon" :size="24" /><span
            ><strong
              >{{ preset.name }}{{ preset.maturity === 'experimental' ? ' · 实验性' : '' }}</strong
            ><small>{{
              presetAlreadyAdded(preset, model)
                ? '已添加，可在列表中启用或停用'
                : preset.description
            }}</small></span
          ><CommonAppIcon v-if="presetAlreadyAdded(preset, model)" name="check" :size="18" />
        </button>
      </div>
      <p v-if="pickerError" role="alert">{{ pickerError }}</p>
    </AdminSourceDialog>
    <AdminSourceDialog
      v-model:show="adding"
      :title="
        candidateGuideOpen && candidateGuide
          ? candidateGuide.title
          : `配置 ${candidate ? title(candidate) : '数据源'}`
      "
      :confirm="candidateGuideOpen ? undefined : '添加来源'"
      :back="candidateGuideOpen"
      :blocked="!canAdd"
      @confirm="addCandidate"
      @closed="candidateClosed"
      @back="closeCandidateGuide"
    >
      <template v-if="candidateGuide" #headerActions>
        <VarButton
          v-show="!candidateGuideOpen"
          text
          round
          class="source-guide-button"
          :aria-label="`查看 ${candidateGuide.title}`"
          title="配置说明"
          @click="openCandidateGuide"
          ><CommonAppIcon name="HelpOutlineRound" :size="20"
        /></VarButton>
      </template>
      <div v-if="candidateGuideOpen && candidateGuide" ref="guideContent" tabindex="-1">
        <AdminSourceGuide :guide="candidateGuide" />
      </div>
      <div v-if="candidate" v-show="!candidateGuideOpen" class="source-candidate-fields">
        <AdminIntegrationEditor
          v-model="candidate"
          :timezone="timezone"
          :expected-version="expectedVersion"
          :quote-symbols="testSymbols(candidate)"
        />
        <p class="admin-note">测试通过后可添加到草稿，点击顶部“保存配置”后生效。</p>
      </div>
    </AdminSourceDialog>
    <AdminSourceDialog v-model:show="savedGuideOpen" :title="savedGuide?.title ?? '配置说明'">
      <AdminSourceGuide v-if="savedGuide" :guide="savedGuide" />
    </AdminSourceDialog>
    <AdminSourceDialog
      v-model:show="removing"
      :title="`删除 ${target ? title(target) : '此来源'}？`"
      confirm="删除来源"
      danger
      :busy="loading"
      :blocked="removalBlocked"
      @confirm="confirmRemoval"
      @closed="afterRemoval"
    >
      <p class="source-target">{{ target ? title(target) : '数据源' }}</p>
      <p>
        从草稿中移除此来源及其凭据，全局保存后生效。缓存快照也会随来源移除；保存前可通过「放弃修改」恢复。
      </p>
      <p v-if="references.length" class="source-warning">
        保存后将自动解除 {{ [...new Set(references)].join('、') }} 的来源匹配。
      </p>
      <p v-if="removal?.protectedHistory" class="source-warning">
        此来源存在受保护的历史数据，无法删除。可以使用标题行开关停用。
      </p>
      <p v-if="removal?.hasSnapshots && !removal.protectedHistory" class="admin-note">
        此来源已有缓存快照，确认删除后不再保留这些缓存。
      </p>
      <p v-if="removalError" class="source-warning" role="alert">{{ removalError }}</p>
    </AdminSourceDialog>
  </div>
</template>
