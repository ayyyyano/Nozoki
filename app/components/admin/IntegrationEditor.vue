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
type Integration = ConfigWrite['integrations'][number]
const model = defineModel<Integration>({ required: true })
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
    if (value === 'tailscale') model.value.baseUrl = 'https://api.tailscale.com/'
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
  'deepseek-spend',
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
    公网直连须在部署环境中批准来源、协议和完整服务根地址；私有来源使用只读 Relay。
  </p>
  <p
    v-if="model.provider === 'quotes-custom' && model.protocolVersion === 'yahoo-chart-v8'"
    class="admin-note"
  >
    Yahoo 默认地址 https://query1.finance.yahoo.com/ 已内置批准，无需密钥。 默认配置已启用并绑定
    QQQM、VOO。新增标的时选择此来源；关闭来源可停止采集。 非官方接口的公开展示许可尚未确认。已有
    Collector 升级时需递增 COLLECTOR_EPOCH。
  </p>
  <div v-if="testResult" role="status" class="admin-note">
    <p>
      {{ testResult.status }} · {{ testResult.code ?? '协议校验通过' }} ·
      {{ testResult.protocolMatched ? '协议匹配' : '协议未确认' }}
    </p>
    <p v-if="testResult.code === 'TARGET_NOT_APPROVED'">
      目标未批准：请核对部署侧公网路由，或私有来源的 Relay 路由与绑定。
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
    账户状态和被动配额观测经中继读取；Management Key
    留在本地中继。插件查询、用量队列和推理接口不被调用。
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
    <div v-for="(c, key) in model.capabilities" :key="key" class="admin-rule">
      <span>{{ key }} · {{ c.verified ? '已有可信验证' : '未验证' }}</span
      ><label><VarSwitch v-model="c.supported" :aria-label="`能力 ${key} 支持`" />支持</label
      ><VarButton text @click="delete model.capabilities[key]">移除能力 {{ key }}</VarButton>
    </div>
    <div class="admin-fields">
      <AdminText v-model="capName" label="能力名称" /><VarButton
        text
        @click="capName && (model.capabilities[capName] = { supported: false, verified: false })"
        >添加未验证能力</VarButton
      >
    </div>
  </details>
</template>
