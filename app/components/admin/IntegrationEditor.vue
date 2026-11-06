<script setup lang="ts">
import type { ProbeResult } from '../../../shared/contracts/adapter'
import { canonical } from '../../../shared/contracts/admin'
import type { CsrfDto } from '../../../shared/contracts/auth'
import type { IntegrationSettings } from '../../../shared/contracts/config'
import {
  DraftIntegrationTestSchema,
  type DraftIntegrationTest,
} from '../../../shared/contracts/integration-test'
import { sourceTargetKey } from '../../../shared/contracts/source-access'
import {
  integrationPreset,
  fixedPresetTarget,
  credentialFields,
  type IntegrationDraft,
} from '../../../shared/integration-presets'
import { formatTimestamp } from '../../../shared/domain/format'
const model = defineModel<IntegrationDraft>({ required: true })
const props = defineProps<{
  timezone: string
  saved?: IntegrationSettings
  expectedVersion: number
  quoteSymbols: { market: string; symbol: string }[]
}>()
const emit = defineEmits<{ tested: [ProbeResult | null, boolean?] }>()
const preset = computed(() => integrationPreset(model.value))
const clock = useLocalClock()
const proofExpired = computed(
  () =>
    !!model.value.connectionProof &&
    Number(model.value.connectionProof.split('.')[0]) <= clock.value,
)
const knownTarget = computed(() => fixedPresetTarget(model.value))
const instanceAddress = computed(
  () => preset.value?.instanceAddress || (!!model.value.baseUrl && !knownTarget.value),
)
const configured = computed(() => props.saved?.credentialState.configured ?? false)
const needsCredential = computed(
  () =>
    preset.value?.authentication !== 'none' ||
    (model.value.access?.mode !== 'legacy' && model.value.access?.authentication === 'bearer'),
)
const showCredential = computed(
  () => needsCredential.value || configured.value || model.value.credential.operation === 'clear',
)
const secrets = computed(() => credentialFields(preset.value))
const credentialLabel = computed(() => preset.value?.credentialLabel || '访问令牌')
const url = computed({
  get: () => model.value.baseUrl ?? '',
  set: (value: string) => {
    model.value.baseUrl = value || null
  },
})
const addressChanged = computed(
  () =>
    configured.value &&
    model.value.credential.operation === 'keep' &&
    model.value.baseUrl !== props.saved?.baseUrl,
)
const savedMatches = computed(() => {
  if (!props.saved || model.value.credential.operation !== 'keep' || model.value.identityCredential)
    return false
  const { credentialState: _state, identityConfigured: _identity, ...saved } = props.saved
  const { credential: _credential, connectionProof: _proof, ...draft } = model.value
  return canonical(saved) === canonical(draft)
})
const testInput = () => {
  const { identityCredential: _identity, connectionProof: _proof, ...draft } = model.value
  return {
    draft: { ...draft, access: { ...approvalAccess(), approved: false } },
    expectedVersion: props.expectedVersion,
    quoteSymbols: props.quoteSymbols,
  }
}
const testFingerprint = () => {
  const input = testInput()
  const {
    enabled: _enabled,
    refreshInterval: _interval,
    capabilities: _caps,
    ...connection
  } = input.draft
  return canonical({ ...input, draft: connection })
}
const canTest = computed(
  () =>
    !!preset.value &&
    !!model.value.baseUrl &&
    !addressChanged.value &&
    DraftIntegrationTestSchema.safeParse(testInput()).success &&
    (!needsCredential.value ||
      (model.value.credential.operation === 'replace'
        ? !!model.value.credential.value.trim()
        : model.value.credential.operation === 'keep' && configured.value)) &&
    (model.value.provider !== 'quotes-custom' || !!props.quoteSymbols.length),
)
const approved = computed(() => {
  try {
    const access = model.value.access
    return (
      !!access &&
      access.mode === 'public' &&
      access.approved &&
      access.approvedTarget === sourceTargetKey(model.value, access)
    )
  } catch {
    return false
  }
})
function approvalAccess() {
  const authentication =
    props.saved?.access &&
    props.saved.access.mode !== 'legacy' &&
    props.saved.access.authentication === 'bearer' &&
    preset.value?.authentication === 'none'
      ? ('bearer' as const)
      : (preset.value?.authentication ?? 'none')
  return {
    mode: 'public' as const,
    authentication,
    approved: true,
    approvedTarget: null as string | null,
  }
}
const targetKey = () => {
  try {
    const a = model.value.access
    return a && a.mode !== 'legacy'
      ? sourceTargetKey(model.value, a)
      : JSON.stringify([model.value.baseUrl, model.value.provider, model.value.protocolVersion])
  } catch {
    return model.value.baseUrl
  }
}
let acceptingTest = false
watch(
  targetKey,
  () => {
    if (acceptingTest) return
    if (model.value.access && model.value.access.mode !== 'legacy') {
      model.value.access.approved = false
      model.value.access.approvedTarget = null
    }
  },
  { flush: 'sync' },
)
function revoke() {
  delete model.value.connectionProof
  result.value = null
  emit('tested', null)
  if (model.value.access && model.value.access.mode !== 'legacy') {
    model.value.access.approved = false
    model.value.access.approvedTarget = null
  }
}
const testing = ref(false),
  result = ref<ProbeResult | null>(null),
  testError = ref('')
let revision = 0
onBeforeUnmount(() => {
  revision++
})
const draftResult = ref(false)
watch(
  testFingerprint,
  () => {
    revision++
    delete model.value.connectionProof
    result.value = null
    testError.value = ''
    emit('tested', null)
  },
  { flush: 'sync' },
)
const feedback = computed(() => {
  if (!result.value) return ''
  const messages: Record<string, string> = {
    ACCESS_NOT_APPROVED: '请先确认来源访问目标。',
    CREDENTIAL_INVALID: '凭据无效，或不能在修改后的目标复用，请重新输入。',
    NOT_CONFIGURED: '请补齐实例地址、凭据或行情标的。',
    SOURCE_CHANGED: '配置已变更，请读取最新配置后重新测试。',
    TARGET_NOT_APPROVED: '请核对实例地址并重新批准。',
    DESTINATION_BLOCKED: '目标地址被安全策略拒绝，请使用可信的公网 HTTPS 服务。',
    CONNECTOR_UNAVAILABLE: '执行环境尚未就绪，请检查部署与加密配置。',
    AUTH_REQUIRED: '认证失败，请核对凭据。',
    CREDENTIAL_UNAVAILABLE: '无法解密凭据，请检查部署密钥。',
    RATE_LIMITED: '来源暂时限流，请稍后重试。',
    SOURCE_DISABLED: '来源已停用。',
    UNSUPPORTED_PROTOCOL: '服务响应与已支持的协议不匹配。',
    INVALID_RESPONSE: '服务返回的数据格式不匹配。',
    NOT_FOUND: '未找到所需的服务端点，请核对实例地址。',
    TIMEOUT: '连接超时，请检查服务状态。',
  }
  return result.value.code
    ? (messages[result.value.code] ?? '连接未完成，请检查服务配置后重试。')
    : result.value.protocolMatched
      ? draftResult.value
        ? '草稿测试通过，尚未保存；各项能力见下方结果。'
        : '连接协议已确认；各项能力见下方结果。'
      : '尚未确认服务协议。'
})
async function testConnection() {
  if (testing.value || !canTest.value) return
  const submitted = testFingerprint(),
    startedRevision = revision,
    unsaved = !savedMatches.value,
    id = model.value.id
  let body: DraftIntegrationTest | undefined = DraftIntegrationTestSchema.parse(testInput())
  testing.value = true
  delete model.value.connectionProof
  result.value = null
  testError.value = ''
  try {
    const csrf = await $fetch<CsrfDto>('/api/auth/csrf')
    const response = await $fetch<ProbeResult>(
      '/api/admin/integrations/' + encodeURIComponent(id) + '/test',
      { method: 'POST', headers: { 'X-Nozoki-CSRF': csrf.token }, body },
    )
    if (revision === startedRevision && testFingerprint() === submitted) {
      if (response.connectionProof) {
        const access = approvalAccess()
        access.approvedTarget = sourceTargetKey(model.value, access)
        acceptingTest = true
        model.value.access = access
        acceptingTest = false
        model.value.connectionProof = response.connectionProof
      }
      draftResult.value = unsaved
      result.value = response
      emit('tested', response, unsaved)
    }
  } catch (e) {
    if (revision !== startedRevision || testFingerprint() !== submitted) return
    const code = (e as { data?: { code?: string } }).data?.code
    testError.value =
      code === 'CONFIG_CONFLICT'
        ? '配置已被其他窗口修改，请读取最新配置后重新测试。'
        : code === 'TEST_LIMITED' || code === 'TEST_BUSY'
          ? '测试暂时受限，请稍后再试。'
          : '测试未完成，请检查登录状态或服务配置。'
  } finally {
    body = undefined
    testing.value = false
  }
}
const identityImport = computed({
  get: () => model.value.identityCredential?.value ?? '',
  set: (value: string) => {
    if (value) model.value.identityCredential = { operation: 'import', value }
    else delete model.value.identityCredential
  },
})
</script>
<template>
  <template v-if="preset">
    <p v-if="preset.note" class="admin-note">{{ preset.note }}</p>
    <div v-if="!instanceAddress" class="source-service-summary">
      <CommonAppIcon name="lock" :size="18" /><span
        >预设服务 · {{ model.baseUrl || '尚未设置' }}</span
      >
      <VarButton v-if="!model.baseUrl" text @click="url = preset.roots[0]!">使用预设地址</VarButton>
    </div>
    <div class="source-settings-grid">
      <AdminText v-if="instanceAddress" v-model="url" label="实例 HTTPS 地址" reserve-details />
      <AdminText
        v-for="field in preset.fields"
        :key="field.key"
        :model-value="model.fieldMappings[field.key] ?? ''"
        :label="field.label"
        :max="field.max"
        reserve-details
        @update:model-value="model.fieldMappings[field.key] = $event"
      />
      <AdminNumber v-model="model.refreshInterval" label="刷新间隔（秒）" />
    </div>
    <AdminSourceCredential
      v-if="showCredential"
      v-model="model.credential"
      :configured="configured"
      :label="credentialLabel"
      :fields="secrets"
      :can-replace="needsCredential"
    />
    <p v-if="showCredential && !needsCredential" class="admin-note">
      此类型不发送凭据；可以清除以前保存的凭据。
    </p>
    <p v-if="addressChanged" class="source-warning" role="status">
      地址已更改。请更新或清除已保存的凭据，再保存此来源。
    </p>
    <p class="admin-note">
      点击测试会访问此 HTTPS 服务{{
        needsCredential ? '并使用填写的凭据' : '，无需凭据'
      }}。测试通过后确认此地址；保存后开始采集。
    </p>
    <div class="admin-actions source-test-actions">
      <VarButton
        tonal
        type="primary"
        :loading="testing"
        :disabled="testing || !canTest"
        @click="testConnection"
        ><CommonAppIcon name="LinkRound" :size="18" />测试并确认访问</VarButton
      >
      <VarButton v-if="approved" tonal @click="revoke">撤销访问批准</VarButton>
      <span v-if="!canTest" class="admin-note">{{
        addressChanged ? '地址已更改，请更新或清除原凭据' : '请补齐此来源的必要配置'
      }}</span>
    </div>
    <div
      v-if="result"
      class="source-test-result"
      role="status"
      :data-test-status="result.code ? 'error' : 'ok'"
    >
      <p>{{ feedback }}</p>
      <small
        >测试时间
        <time :datetime="result.collectedAt">{{
          formatTimestamp(result.collectedAt, timezone)
        }}</time
        >（{{ timezone }}）</small
      >
      <p v-if="result.retryAfterSeconds">请至少等待 {{ result.retryAfterSeconds }} 秒后重试。</p>
    </div>
    <p v-if="proofExpired" class="source-warning" role="status">
      测试结果已过期，请重新测试后保存。
    </p>
    <p v-if="testError" class="source-warning" role="alert">{{ testError }}</p>
    <ul v-if="preset.capabilities.length" class="source-capabilities" aria-label="能力状态">
      <li v-for="capability in preset.capabilities" :key="capability.key">
        {{ capability.label }} ·
        {{ result?.capabilities[capability.key]?.verified ? '已验证' : '尚未验证' }}
      </li>
    </ul>
    <details v-if="preset.identityImport && !saved?.identityConfigured" class="admin-details">
      <summary>迁移已有账户权限</summary>
      <AdminText
        v-model="identityImport"
        label="原账户身份密钥（迁移时填写）"
        secret
        :max="43"
        reserve-details
      />
      <p class="admin-note">
        新来源留空。迁移旧账户权限时填写原有密钥；保存前会只读核对账户身份，匹配后加密保存。
      </p>
    </details>
  </template>
  <p v-else class="source-warning" role="status">
    此来源的旧协议暂不支持编辑，原配置和历史记录已保留。可以停用，或新建受支持的来源。
  </p>
</template>
