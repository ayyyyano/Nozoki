<script setup lang="ts">
import {
  ADAPTER_PROTOCOLS,
  defaultProtocol,
  type ProbeResult,
} from '../../../shared/contracts/adapter'
import { canonical } from '../../../shared/contracts/admin'
import type { CsrfDto } from '../../../shared/contracts/auth'
import type { ConfigWrite, IntegrationSettings } from '../../../shared/contracts/config'
import { formatTimestamp } from '../../../shared/domain/format'
import { managedServiceRoot, sourceTargetKey } from '../../../shared/contracts/source-access'
type Integration = ConfigWrite['integrations'][number]
const model = defineModel<Integration>({ required: true })
const approvalId = useId()
type EgressStatus = {
  configured: boolean
  publicMode: 'worker' | 'connector' | 'unavailable'
  privateConfigured: boolean
  environmentMatches: boolean | null
}
const connector = ref<EgressStatus | null>(null)
onMounted(async () => {
  try {
    connector.value = await $fetch<EgressStatus>('/api/admin/source-connector')
  } catch {
    connector.value = null
  }
})
const accessMode = computed(() => model.value.access?.mode ?? 'legacy')
function preparePublicAccess() {
  if (!model.value.baseUrl) throw new Error()
  managedServiceRoot(model.value.baseUrl, 'public')
  if (model.value.access?.mode !== 'public')
    model.value.access = {
      mode: 'public',
      authentication: defaultAuthentication(model.value.provider),
      approved: false,
      approvedTarget: null,
    }
}
function defaultAuthentication(provider: Integration['provider']) {
  return provider === 'tailscale'
    ? ('tailscale-oauth' as const)
    : provider === 'cliproxy-bridge' || provider === 'deepseek'
      ? ('bearer' as const)
      : ('none' as const)
}
const authentication = computed({
  get: () =>
    model.value.access && model.value.access.mode !== 'legacy'
      ? model.value.access.authentication
      : defaultAuthentication(model.value.provider),
  set: (value: 'none' | 'bearer' | 'tailscale-oauth') => {
    try {
      preparePublicAccess()
    } catch {
      return
    }
    if (model.value.access && model.value.access.mode === 'public')
      model.value.access.authentication = value
  },
})
const identityImport = computed({
  get: () => model.value.identityCredential?.value ?? '',
  set: (value: string) => {
    if (value) model.value.identityCredential = { operation: 'import', value }
    else delete model.value.identityCredential
  },
})
function targetIdentity() {
  try {
    if (model.value.access && model.value.access.mode !== 'legacy')
      return sourceTargetKey(model.value, model.value.access)
  } catch {
    /* Preserve incomplete input until the administrator finishes editing. */
  }
  return JSON.stringify([
    model.value.id,
    model.value.provider,
    model.value.protocolVersion,
    model.value.baseUrl,
    model.value.access?.mode,
    authentication.value,
  ])
}
watch(
  targetIdentity,
  () => {
    if (model.value.access && model.value.access.mode !== 'legacy') {
      model.value.access.approved = false
      model.value.access.approvedTarget = null
    }
  },
  { flush: 'sync' },
)
const showApproval = ref(false),
  approvalPanel = useTemplateRef<HTMLElement>('approvalPanel'),
  approvalFocus = useModalFocus(showApproval, approvalPanel)
const approvalMessage = ref('')
let pendingTarget = ''
function approveSource() {
  try {
    preparePublicAccess()
    if (!model.value.baseUrl || !model.value.access || model.value.access.mode !== 'public')
      throw new Error()
    pendingTarget = sourceTargetKey(model.value, model.value.access)
    approvalMessage.value = ''
    showApproval.value = true
  } catch {
    approvalMessage.value = '请先填写合法的服务根 HTTPS 地址。'
  }
}
function confirmApproval() {
  if (
    model.value.access &&
    model.value.access.mode !== 'legacy' &&
    pendingTarget === sourceTargetKey(model.value, model.value.access)
  ) {
    model.value.access.approved = true
    model.value.access.approvedTarget = pendingTarget
  }
  showApproval.value = false
}
function revokeApproval() {
  if (model.value.access && model.value.access.mode !== 'legacy') {
    model.value.access.approved = false
    model.value.access.approvedTarget = null
  }
}
const props = defineProps<{
  timezone: string
  state?: IntegrationSettings['credentialState']
  saved?: IntegrationSettings
}>()
const versions = computed<readonly string[]>(() => ADAPTER_PROTOCOLS[model.value.provider])
const provider = computed({
  get: () => model.value.provider,
  set: (value: Integration['provider']) => {
    if (value === model.value.provider) return
    model.value.provider = value
    model.value.protocolVersion = defaultProtocol(value)
    delete model.value.identityCredential
    if (value === 'tailscale') model.value.baseUrl = 'https://api.tailscale.com/'
    model.value.access = {
      mode: 'public',
      authentication: defaultAuthentication(value),
      approved: false,
      approvedTarget: null,
    }
  },
})
const testing = ref(false),
  testResult = ref<ProbeResult | null>(null),
  testMessage = ref('')
const savedMatches = computed(() => {
  if (!props.saved || model.value.credential.operation !== 'keep' || model.value.identityCredential)
    return false
  const { credentialState: _state, identityConfigured: _identity, ...saved } = props.saved
  const { credential: _credential, ...draft } = model.value
  return canonical(saved) === canonical(draft)
})
watch(
  model,
  () => {
    testResult.value = null
    testMessage.value = ''
  },
  { deep: true },
)
async function testConnection() {
  if (testing.value || !savedMatches.value) return
  testing.value = true
  testMessage.value = ''
  testResult.value = null
  const id = model.value.id,
    submitted = canonical(model.value)
  try {
    const csrf = await $fetch<CsrfDto>('/api/auth/csrf')
    const result = await $fetch<ProbeResult>(
      '/api/admin/integrations/' + encodeURIComponent(id) + '/test',
      { method: 'POST', headers: { 'X-Nozoki-CSRF': csrf.token }, body: {} },
    )
    if (savedMatches.value && canonical(model.value) === submitted) testResult.value = result
  } catch (e) {
    const code = (e as { data?: { code?: string } }).data?.code
    testMessage.value =
      code === 'TEST_LIMITED' || code === 'TEST_BUSY'
        ? '测试暂时受限，请稍后重试'
        : '测试无法完成，请确认登录状态或服务配置'
  } finally {
    testing.value = false
  }
}
const nullableUrl = computed({
  get: () => model.value.baseUrl ?? '',
  set: (v) => {
    model.value.baseUrl = v || null
  },
})
const statusPageSlug = computed({
  get: () => model.value.fieldMappings.status_page_slug ?? '',
  set: (value: string) => {
    model.value.fieldMappings.status_page_slug = value
  },
})
const providers = [
  'deepseek',
  'sleepy',
  'tailscale',
  'cliproxy-bridge',
  'uptime-kuma',
  'uptimeflare',
  'quotes-custom',
]
const fieldName = ref(''),
  mapping = ref(''),
  capName = ref('')
const visibleCapabilities = computed(() =>
  Object.fromEntries(
    Object.entries(model.value.capabilities).filter(
      ([key]) =>
        !(model.value.provider === 'cliproxy-bridge' && ['usage', 'estimatedCost'].includes(key)),
    ),
  ),
)
function addCapability() {
  if (
    capName.value &&
    !(
      model.value.provider === 'cliproxy-bridge' &&
      ['usage', 'estimatedCost'].includes(capName.value)
    )
  )
    model.value.capabilities[capName.value] = { supported: false, verified: false }
}
function oauthField(key: 'clientId' | 'clientSecret') {
  return computed({
    get: () => {
      if (model.value.credential.operation !== 'replace') return ''
      try {
        const value = JSON.parse(model.value.credential.value)[key]
        return typeof value === 'string' ? value : ''
      } catch {
        return ''
      }
    },
    set: (value: string) => {
      if (model.value.credential.operation !== 'replace') return
      let current: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(model.value.credential.value)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          current = parsed as Record<string, unknown>
      } catch {
        /* A new replacement starts empty. */
      }
      model.value.credential.value = JSON.stringify({
        clientId: typeof current.clientId === 'string' ? current.clientId : '',
        clientSecret: typeof current.clientSecret === 'string' ? current.clientSecret : '',
        [key]: value,
      })
    },
  })
}
const oauthClientId = oauthField('clientId'),
  oauthClientSecret = oauthField('clientSecret')
function operation(value: unknown) {
  model.value.credential =
    value === 'replace'
      ? { operation: 'replace', value: '' }
      : value === 'clear'
        ? { operation: 'clear' }
        : { operation: 'keep' }
}
</script>
<template>
  <div class="admin-fields">
    <AdminText v-model="model.id" label="来源 ID" :max="64" />
    <VarSelect v-model="provider" placeholder="Provider" aria-label="Provider" variant="outlined"
      ><VarOption v-for="p in providers" :key="p" :label="p" :value="p"
    /></VarSelect>
    <p v-if="model.provider === 'deepseek-spend'" class="admin-note">
      此旧来源协议暂不可用，请选择受支持的 Provider。
    </p>
    <AdminText v-model="nullableUrl" label="服务根 HTTPS 地址" />
    <AdminText
      v-if="model.provider === 'uptime-kuma'"
      v-model="statusPageSlug"
      label="公开状态页 slug"
      :max="64"
    />
    <VarSelect
      :key="model.provider"
      v-model="model.protocolVersion"
      placeholder="协议版本"
      aria-label="协议版本"
      variant="outlined"
      ><VarOption
        v-if="!versions.includes(model.protocolVersion)"
        :label="'未支持：' + model.protocolVersion"
        :value="model.protocolVersion" /><VarOption
        v-for="version in versions"
        :key="version"
        :label="version"
        :value="version"
    /></VarSelect>
    <AdminNumber v-model="model.refreshInterval" label="来源刷新间隔（秒）" />
    <label><VarSwitch v-model="model.enabled" aria-label="启用来源" />启用来源</label>
  </div>
  <p class="admin-note">
    {{ state?.configured ? '凭据已配置' : '凭据未配置' }} · 未验证连接。更改 Provider
    或服务根地址时，须替换或清除原凭据。
  </p>
  <p class="admin-note">后台管理 · 公网 HTTPS</p>
  <p v-if="accessMode !== 'public'" role="status" class="admin-note">
    旧接入方式已暂停。请核对公网地址和认证方式，批准并保存后迁移；原来源
    ID、凭据与权限保留。私网地址须先改为可公开访问的 HTTPS 服务。
  </p>
  <VarSelect
    v-model="authentication"
    aria-label="上游认证方式"
    placeholder="上游认证方式"
    variant="outlined"
  >
    <template v-if="model.provider !== 'tailscale'">
      <VarOption label="不发送凭据" value="none" />
      <VarOption label="Bearer · 使用后台保存的凭据" value="bearer" />
    </template>
    <VarOption v-else label="Tailscale OAuth Client" value="tailscale-oauth" />
  </VarSelect>
  <div>
    <p class="admin-note" role="status">
      {{
        model.access && model.access.mode === 'public' && model.access.approved
          ? '此目标已在草稿中批准'
          : '此目标尚未批准'
      }}；批准或撤销均在保存配置后生效。
    </p>
    <p class="admin-note">
      {{
        connector?.publicMode === 'worker'
          ? accessMode === 'private'
            ? 'Workers 公网出站不支持私网来源；请使用可公开访问的 HTTPS 服务地址。'
            : '使用 Workers 原生公网 HTTPS 出站，在此批准并保存即可接入。'
          : connector?.configured
            ? '使用服务器内嵌的受限公网出站。'
            : '服务器出站尚未就绪，请检查运行环境。'
      }}{{
        connector?.environmentMatches === false
          ? '；当前部署已过期或采集环境异常，请重新部署并等待下一次定时采集'
          : ''
      }}
    </p>
    <div class="admin-actions">
      <VarButton
        @click="
          model.access && model.access.mode === 'public' && model.access.approved
            ? revokeApproval()
            : approveSource()
        "
        >{{
          model.access && model.access.mode === 'public' && model.access.approved
            ? '撤销批准'
            : '批准此来源'
        }}</VarButton
      >
    </div>
    <p v-if="approvalMessage" role="alert" class="admin-note">{{ approvalMessage }}</p>
  </div>
  <VarSelect
    :model-value="model.credential.operation"
    aria-label="凭据操作"
    placeholder="凭据操作"
    variant="outlined"
    @update:model-value="operation"
    ><VarOption label="keep · 保留" value="keep" /><VarOption
      label="replace · 替换"
      value="replace" /><VarOption label="clear · 明确清除" value="clear"
  /></VarSelect>
  <template v-if="model.credential.operation === 'replace' && model.provider === 'tailscale'">
    <AdminText v-model="oauthClientId" label="OAuth Client ID" :max="4096" />
    <AdminText v-model="oauthClientSecret" label="OAuth Client Secret" secret :max="4096" />
  </template>
  <AdminText
    v-else-if="model.credential.operation === 'replace'"
    v-model="model.credential.value"
    label="新凭据"
    secret
    :max="8192"
  />
  <p v-if="model.credential.operation === 'clear'" class="admin-note">保存后将清除该来源的凭据。</p>
  <p v-if="model.provider === 'tailscale'" class="admin-note">
    使用 Tailscale OAuth Client，仅授予 devices:core:read。保存后，在 Dashboard 模块中启用 Tailscale
    并绑定此来源；IP 显示策略单独配置。
  </p>
  <div class="admin-actions">
    <VarButton :loading="testing" :disabled="testing || !savedMatches" @click="testConnection"
      >只读测试连接</VarButton
    ><span class="admin-note">{{
      savedMatches ? '只读取已保存来源；不采集或保存快照' : '请先保存此来源的修改'
    }}</span>
  </div>
  <p class="admin-note">
    仅使用已登记协议的只读端点；目标地址、协议或认证方式变化后需要重新批准。公网禁止私网、回环及元数据地址。
  </p>
  <p
    v-if="model.provider === 'quotes-custom' && model.protocolVersion === 'yahoo-chart-v8'"
    class="admin-note"
  >
    Yahoo
    是可选的非官方行情来源，无需密钥；可能限制数据中心出口。默认行情使用腾讯。修改地址后请重新批准并保存。
  </p>
  <div v-if="testResult" role="status" class="admin-note">
    <p>
      {{ testResult.status }} · {{ testResult.code ?? '协议校验通过' }} ·
      {{ testResult.protocolMatched ? '协议匹配' : '协议未确认' }}
    </p>
    <p v-if="testResult.code === 'TARGET_NOT_APPROVED'">
      请核对服务根地址、协议与认证方式，并重新批准和保存。
    </p>
    <p v-if="testResult.code === 'ACCESS_NOT_APPROVED'">请批准当前目标并保存配置后再测试。</p>
    <p v-if="testResult.code === 'CONNECTOR_UNAVAILABLE'">
      执行环境尚未就绪。请检查部署状态与加密配置；Workers 的网页和采集共用同一份配置。
    </p>
    <p v-if="testResult.code === 'DESTINATION_BLOCKED'">
      目标不在允许的公网范围内。请使用可公开访问的 HTTPS 服务地址。
    </p>
    <p>
      已验证能力：{{
        Object.entries(testResult.capabilities)
          .filter(([, c]) => c.verified)
          .map(([name]) => name)
          .join('、') || '无'
      }}；测试时间
      <time :datetime="testResult.collectedAt">{{
        formatTimestamp(testResult.collectedAt, timezone)
      }}</time
      >（{{ timezone }}）
    </p>
    <p v-if="testResult.retryAfterSeconds">
      请至少等待 {{ testResult.retryAfterSeconds }} 秒后重试。
    </p>
  </div>
  <p v-if="testMessage" role="alert">{{ testMessage }}</p>
  <template
    v-if="model.provider === 'cliproxy-bridge' && model.protocolVersion === 'cliproxy-v8-accounts'"
  >
    <p class="admin-note">
      Management Key 使用上方 Bearer 凭据。账户身份密钥独立加密保存，不作为上游认证凭据发送。
    </p>
    <template v-if="!saved?.identityConfigured">
      <AdminText
        v-model="identityImport"
        label="旧 Relay 账户身份密钥（迁移时选填）"
        secret
        :max="43"
      />
      <p class="admin-note">
        迁移旧账户权限时，填入原 Relay 的 43 位身份密钥，并补齐 Management Key。保存前会只读核对账户
        ID；不匹配时拒绝迁移。新来源留空即可自动生成。
      </p>
    </template>
  </template>
  <details class="admin-details">
    <summary>字段映射与能力元数据</summary>
    <div v-for="(_, key) in model.fieldMappings" :key="key" class="admin-rule">
      <AdminText v-model="model.fieldMappings[key]!" :label="`映射 ${key}`" /><VarButton
        text
        @click="delete model.fieldMappings[key]"
        >移除映射 {{ key }}</VarButton
      >
    </div>
    <div class="admin-fields">
      <AdminText v-model="fieldName" label="映射名称" /><AdminText
        v-model="mapping"
        label="上游字段路径"
      /><VarButton text @click="fieldName && (model.fieldMappings[fieldName] = mapping)"
        >添加映射</VarButton
      >
    </div>
    <div v-for="(c, key) in visibleCapabilities" :key="key" class="admin-rule">
      <span>{{ key }} · {{ c.verified ? '已有可信验证' : '未验证' }}</span
      ><label><VarSwitch v-model="c.supported" :aria-label="`能力 ${key} 支持`" />支持</label
      ><VarButton text @click="delete model.capabilities[key]">移除能力 {{ key }}</VarButton>
    </div>
    <div class="admin-fields">
      <AdminText v-model="capName" label="能力名称" /><VarButton text @click="addCapability"
        >添加未验证能力</VarButton
      >
    </div>
  </details>
  <VarPopup
    v-model:show="showApproval"
    position="center"
    :default-style="false"
    :close-on-key-escape="true"
    @closed="approvalFocus.restoreFocus"
  >
    <section
      ref="approvalPanel"
      class="admin-confirm"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="approvalId"
      tabindex="-1"
      @keydown.esc="showApproval = false"
    >
      <h2 :id="approvalId">批准来源访问？</h2>
      <p class="admin-note" style="overflow-wrap: anywhere">{{ model.baseUrl }}</p>
      <p>
        {{ model.provider }} · {{ model.protocolVersion }} ·
        {{
          authentication === 'tailscale-oauth'
            ? '仅向 Tailscale 官方端点交换只读令牌'
            : authentication === 'bearer'
              ? '发送该来源的 Bearer 凭据'
              : '不发送凭据'
        }}
      </p>
      <p>请确认服务由可信运营者控制。批准只允许已登记的只读端点和公网地址。保存后生效。</p>
      <div class="admin-actions">
        <VarButton text @click="showApproval = false">取消</VarButton
        ><VarButton type="primary" @click="confirmApproval">确认批准</VarButton>
      </div>
    </section>
  </VarPopup>
</template>
