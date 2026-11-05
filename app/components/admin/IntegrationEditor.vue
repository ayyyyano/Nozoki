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
import { sourceTargetKey } from '../../../shared/contracts/source-access'
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
const accessMode = computed({
  get: () => model.value.access?.mode ?? 'legacy',
  set: (mode: 'legacy' | 'public' | 'private') => {
    model.value.access =
      mode === 'legacy'
        ? { mode }
        : {
            mode,
            authentication: model.value.provider === 'cliproxy-bridge' ? 'bearer' : 'none',
            approved: false,
            approvedTarget: null,
          }
  },
})
const authentication = computed({
  get: () =>
    model.value.access?.mode !== 'legacy' && model.value.access
      ? model.value.access.authentication
      : 'none',
  set: (value: 'none' | 'bearer') => {
    if (model.value.access && model.value.access.mode !== 'legacy')
      model.value.access.authentication = value
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
    if (!model.value.baseUrl || !model.value.access || model.value.access.mode === 'legacy')
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
    if (value === 'cliproxy-bridge' && model.value.access && model.value.access.mode !== 'legacy')
      model.value.access.authentication = 'bearer'
    if (value === 'tailscale') {
      model.value.baseUrl = 'https://api.tailscale.com/'
      model.value.access = { mode: 'legacy' }
    }
  },
})
const testing = ref(false),
  testResult = ref<ProbeResult | null>(null),
  testMessage = ref('')
const savedMatches = computed(() => {
  if (!props.saved || model.value.credential.operation !== 'keep') return false
  const { credentialState: _state, ...saved } = props.saved
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
  <div class="admin-fields">
    <VarSelect v-model="accessMode" aria-label="接入方式" placeholder="接入方式" variant="outlined">
      <VarOption label="内置服务 / 兼容旧配置" value="legacy" />
      <VarOption label="后台管理 · 公网 HTTPS" value="public" />
      <VarOption
        v-if="connector?.publicMode !== 'worker' || accessMode === 'private'"
        label="后台管理 · 受限私网 HTTPS"
        value="private"
      />
    </VarSelect>
    <VarSelect
      v-if="accessMode !== 'legacy'"
      v-model="authentication"
      aria-label="上游认证方式"
      placeholder="上游认证方式"
      variant="outlined"
    >
      <VarOption label="不发送凭据" value="none" />
      <VarOption label="Bearer · 使用后台保存的凭据" value="bearer" />
    </VarSelect>
  </div>
  <template v-if="model.access && model.access.mode !== 'legacy'">
    <p class="admin-note" role="status">
      {{
        model.access.approved ? '此目标已在草稿中批准' : '此目标尚未批准'
      }}；批准或撤销均在保存配置后生效。
    </p>
    <p class="admin-note">
      {{
        connector?.publicMode === 'worker'
          ? accessMode === 'private'
            ? 'Workers 公网出站不支持私网来源；请使用可公开访问的 HTTPS 服务地址。'
            : '使用 Workers 原生公网 HTTPS 出站，在此批准并保存即可接入。'
          : connector?.configured
            ? '使用服务器内嵌或已配置的受限连接器。'
            : '服务器出站尚未就绪，请检查运行环境。'
      }}{{
        connector?.environmentMatches === false
          ? '；当前部署已过期或采集环境异常，请重新部署并等待下一次定时采集'
          : ''
      }}
    </p>
    <div class="admin-actions">
      <VarButton @click="model.access.approved ? revokeApproval() : approveSource()">{{
        model.access.approved ? '撤销批准' : '批准此来源'
      }}</VarButton>
    </div>
    <p v-if="approvalMessage" role="alert" class="admin-note">{{ approvalMessage }}</p>
  </template>
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
    {{
      accessMode === 'legacy'
        ? '固定官方服务可直接使用；旧自建来源继续采用原部署授权，切换到后台管理后可在此批准目标。'
        : '仅使用已登记协议的只读端点；目标地址或认证方式变化后需要重新批准。公网禁止私网、回环及元数据地址，私网还受部署网段限制。'
    }}
  </p>
  <p
    v-if="model.provider === 'quotes-custom' && model.protocolVersion === 'yahoo-chart-v8'"
    class="admin-note"
  >
    Yahoo 默认地址 https://query1.finance.yahoo.com/ 已内置批准，无需密钥。 默认配置已启用并绑定
    QQQM、VOO。新增标的时选择此来源；关闭来源可停止采集。 非官方接口的公开展示许可尚未确认。Worker
    部署后由定时任务采集。
  </p>
  <div v-if="testResult" role="status" class="admin-note">
    <p>
      {{ testResult.status }} · {{ testResult.code ?? '协议校验通过' }} ·
      {{ testResult.protocolMatched ? '协议匹配' : '协议未确认' }}
    </p>
    <p v-if="testResult.code === 'TARGET_NOT_APPROVED'">
      目标未批准：请核对部署侧公网路由，或私有来源的 Relay 路由与绑定。
    </p>
    <p v-if="testResult.code === 'ACCESS_NOT_APPROVED'">请批准当前目标并保存配置后再测试。</p>
    <p v-if="testResult.code === 'CONNECTOR_UNAVAILABLE'">
      执行环境尚未就绪。请检查部署状态与加密配置；Workers 的网页和采集共用同一份配置。
    </p>
    <p v-if="testResult.code === 'DESTINATION_BLOCKED'">
      目标不在允许的网络范围内。Workers 仅支持公网 HTTPS；服务器私网来源还需要配置允许网段。
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
  <p
    v-if="model.provider === 'cliproxy-bridge' && model.protocolVersion === 'cliproxy-v8-accounts'"
    class="admin-note"
  >
    {{
      accessMode === 'legacy'
        ? '账户状态与被动配额经旧 Relay 读取，Management Key 留在 Relay。'
        : 'Management Key 使用后台凭据，发送至已批准的只读账户端点；稳定账户身份密钥自动生成并加密保存。'
    }}
  </p>
  <p
    v-if="
      model.provider === 'cliproxy-bridge' &&
      accessMode !== 'legacy' &&
      (!saved?.access || saved.access.mode === 'legacy')
    "
    class="admin-note"
  >
    切换旧 Relay 会更换匿名账户 ID。请先检查 Dashboard 模块中按账户 ID
    设置的权限，改用通配规则后再保存。
  </p>
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
        {{ authentication === 'bearer' ? '发送该来源的 Bearer 凭据' : '不发送凭据' }}
      </p>
      <p>
        请确认服务由可信运营者控制。批准只允许已登记的只读端点；私网访问仍受部署网段限制。保存后生效。
      </p>
      <div class="admin-actions">
        <VarButton text @click="showApproval = false">取消</VarButton
        ><VarButton type="primary" @click="confirmApproval">确认批准</VarButton>
      </div>
    </section>
  </VarPopup>
</template>
