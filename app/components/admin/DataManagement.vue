<script setup lang="ts">
import { canonical, editableConfig } from '../../../shared/contracts/admin'
import type { Config } from '../../../shared/contracts/config'
import type { ConfigBackup } from '../../../shared/contracts/config-backup'
import type { CsrfDto } from '../../../shared/contracts/auth'
import type { ProbeResult } from '../../../shared/contracts/adapter'
import { BACKUP_HISTORY_FILE_LIMIT } from '../../../shared/contracts/config-backup'
type CollectedHistoryCounts = {
  balanceObservations: number
  dailyUsage: number
  codexUsageDays: number
  collectionRuns: number
  snapshotViews: number
  serviceObservations: number
  serviceHeartbeatWindows: number
}
import {
  prepareConfigImport,
  globalDefaultConfig,
  type ConfigImportPlan,
} from '../../../shared/domain/config-backup'
import { requiresSourceTest } from '../../../shared/integration-presets/connection'
import { integrationPreset } from '../../../shared/integration-presets'
import { bindSources } from '../../../shared/integration-presets/bindings'
import {
  planImportCredentialTests,
  applyImportCredentialTest,
  summarizeImportCredentialTests,
} from '../../../shared/domain/import-credential-tests'

const props = defineProps<{ baseline: Config; disabled: boolean; dirty: boolean }>()
const emit = defineEmits<{ apply: [ConfigImportPlan, 'import' | 'reset'] }>()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const importing = ref(false),
  working = ref(false)
const includeCredentials = ref(false)
const includeHistory = ref(false)
const plan = ref<ConfigImportPlan | null>(null),
  error = ref('')
const importResults = ref<Record<string, string>>({})
const importProgress = ref('')
const importOutcomes = ref<Record<string, { proof?: string }>>({})
const exportFeedback = ref('')
const exportTone = ref<'success' | 'error'>('success')
const exportFeedbackOpen = ref(false)
let exportFeedbackTimer: ReturnType<typeof setTimeout> | undefined
function showExportFeedback(message: string, tone: 'success' | 'error') {
  exportFeedback.value = message
  exportTone.value = tone
  exportFeedbackOpen.value = true
  if (exportFeedbackTimer) clearTimeout(exportFeedbackTimer)
  exportFeedbackTimer = setTimeout(() => (exportFeedbackOpen.value = false), 4000)
}
const importSummary = computed(() =>
  summarizeImportCredentialTests(Object.values(importOutcomes.value)),
)
const clock = useLocalClock()
let generation = 0
function wipe() {
  generation++
  for (const source of plan.value?.config.integrations ?? []) {
    source.credential = { operation: 'keep' }
    delete source.connectionProof
    delete source.identityCredential
  }
  plan.value = null
  importResults.value = {}
  importProgress.value = ''
  importOutcomes.value = {}
}
onBeforeUnmount(() => {
  wipe()
  if (exportFeedbackTimer) clearTimeout(exportFeedbackTimer)
})
const tests = computed(
  () =>
    plan.value?.config.integrations.filter((source) =>
      requiresSourceTest(
        source,
        props.baseline.integrations.find((s) => s.id === source.id),
      ),
    ) ?? [],
)
const canApply = computed(
  () =>
    !!plan.value &&
    !props.disabled &&
    !working.value &&
    tests.value.every(
      (s) =>
        s.credential.operation === 'replace' ||
        (!!s.connectionProof && Number(s.connectionProof.split('.')[0]) > clock.value),
    ),
)
const pendingCredentialTests = computed(() =>
  plan.value
    ? planImportCredentialTests(plan.value.config.integrations, props.baseline).some((item) => {
        const proof = plan.value?.config.integrations.find((s) => s.id === item.id)?.connectionProof
        return item.needsTest && (!proof || Number(proof.split('.')[0]) <= clock.value)
      })
    : false,
)
const importErrors: Record<string, string> = {
  BACKUP_TOO_LARGE: '配置文件过大，请减少配置内容或压缩背景图片后重试。',
  BACKUP_INVALID_IMAGE: '备份中的背景图片缺失或校验不通过。',
  BACKUP_DUPLICATE_SOURCE: '备份包含重复的数据源类型，请整理后重试。',
  BACKUP_UNSUPPORTED_SOURCE: '备份包含当前站点无法兼容的旧协议来源。',
  BACKUP_IDENTITY_CONFLICT: '目标来源已有身份密钥或来源标识不同，无法安全导入身份密钥。',
  BACKUP_HISTORY_NOT_IMPORTABLE: '备份包含采集历史，仅用于归档；请使用不含历史的导出重新导入。',
}
const testFailureReasons: Record<string, string> = {
  AUTH_REQUIRED: '认证失败',
  CREDENTIAL_INVALID: '凭据无效',
  CONNECTOR_UNAVAILABLE: '连接环境不可用',
  DESTINATION_BLOCKED: '目标未通过安全检查',
  RATE_LIMITED: '来源限流',
  TEST_LIMITED: '测试次数受限',
  TEST_BUSY: '测试繁忙',
  TIMEOUT: '连接超时',
  NOT_FOUND: '接口不存在',
  INVALID_RESPONSE: '响应格式不匹配',
  CONFIG_CONFLICT: '配置已被其他窗口修改',
  TEST_UNAVAILABLE: '网络或测试服务不可用',
  TEST_FAILED: '测试未通过',
}
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || props.disabled || working.value) return
  wipe()
  const revision = generation
  working.value = true
  error.value = ''
  try {
    if (file.size > BACKUP_HISTORY_FILE_LIMIT) throw new Error('BACKUP_TOO_LARGE')
    const prepared = await prepareConfigImport(await file.text(), props.baseline)
    if (revision !== generation) return
    plan.value = prepared
    for (const action of planImportCredentialTests(prepared.config.integrations, props.baseline)) {
      if (action.reason === 'imported_credential' && !action.needsTest)
        importResults.value[action.id] = '凭据可在保存后迁移；访问状态保持未批准。'
    }
    importing.value = true
  } catch (e) {
    if (revision === generation)
      error.value =
        importErrors[(e as Error).message] ?? '无法读取此配置文件。请检查文件格式、版本及配置内容。'
  } finally {
    working.value = false
    importProgress.value = ''
  }
}
function skipSource(id: string) {
  if (!plan.value) return
  const index = plan.value.config.integrations.findIndex((s) => s.id === id)
  const source = plan.value.config.integrations[index]
  if (source) source.credential = { operation: 'keep' }
  const old = props.baseline.integrations.find((s) => s.id === id)
  if (old) {
    plan.value.config.integrations[index] = editableConfig(props.baseline).integrations.find(
      (s) => s.id === id,
    )!
  } else plan.value.config.integrations.splice(index, 1)
  plan.value.config = bindSources(plan.value.config)
}
function symbols(id: string) {
  const values = plan.value?.config.quotes.filter((q) => q.enabled && q.provider === id).slice(0, 1)
  return values?.length
    ? values.map(({ market, symbol }) => ({ market, symbol }))
    : [{ market: 'US', symbol: 'QQQM' }]
}
function importSourceName(id: string) {
  const source = plan.value?.config.integrations.find((item) => item.id === id)
  return (source && integrationPreset(source)?.name) || id
}
async function applyImport() {
  if (!plan.value || !canApply.value) return
  const prepared = plan.value
  const actions = planImportCredentialTests(prepared.config.integrations, props.baseline).filter(
    (item) => {
      const proof = prepared.config.integrations.find((s) => s.id === item.id)?.connectionProof
      return item.needsTest && (!proof || Number(proof.split('.')[0]) <= clock.value)
    },
  )
  if (actions.length) {
    const revision = generation
    working.value = true
    try {
      for (const [index, action] of actions.entries()) {
        if (revision !== generation || !plan.value) return
        const source = prepared.config.integrations.find((item) => item.id === action.id)!
        importProgress.value = `正在验证来源 ${index + 1} / ${actions.length}：${integrationPreset(source)?.name ?? source.id}`
        const { identityCredential: _identity, connectionProof: _proof, ...draft } = source
        const submitted = canonical(draft)
        let proof: string | undefined
        let reason = 'TEST_UNAVAILABLE'
        try {
          const csrf = await $fetch<CsrfDto>('/api/auth/csrf')
          const response = await $fetch<ProbeResult>(
            `/api/admin/integrations/${encodeURIComponent(source.id)}/test`,
            {
              method: 'POST',
              headers: { 'X-Nozoki-CSRF': csrf.token },
              timeout: 30000,
              body: {
                draft,
                expectedVersion: props.baseline.site.configVersion,
                quoteSymbols: symbols(source.id),
              },
            },
          )
          proof = response.connectionProof
          reason = response.code ?? 'TEST_FAILED'
        } catch (e) {
          const code = (e as { data?: { code?: string } }).data?.code
          reason = code && /^[A-Z_]{1,48}$/.test(code) ? code : 'TEST_UNAVAILABLE'
        }
        if (revision !== generation || !plan.value) return
        const position = prepared.config.integrations.findIndex((item) => item.id === action.id)
        if (position < 0) continue
        const {
          identityCredential: _currentIdentity,
          connectionProof: _currentProof,
          ...currentDraft
        } = prepared.config.integrations[position]!
        if (canonical(currentDraft) !== submitted) {
          importResults.value[action.id] = '配置已变更，请重新验证。'
          continue
        }
        prepared.config.integrations[position] = applyImportCredentialTest(source, {
          proof,
          reason,
        })
        importOutcomes.value[action.id] = { proof }
        importResults.value[action.id] = proof
          ? '验证通过并批准，保存后采集即可恢复。'
          : `凭据未迁移：${testFailureReasons[reason] ?? '测试未通过'}`
      }
    } finally {
      working.value = false
      importProgress.value = ''
    }
    return
  }
  plan.value = null
  emit('apply', prepared, 'import')
  importing.value = false
}
const resetting = ref(false)
const resetConfirm = ref('')
const historyCounts = ref<CollectedHistoryCounts | null>(null)
async function openReset() {
  if (props.disabled || working.value) return
  resetting.value = true
  resetConfirm.value = ''
  try {
    historyCounts.value = await $fetch<CollectedHistoryCounts>('/api/admin/data/history-counts', {
      timeout: 15000,
    })
  } catch {
    historyCounts.value = null
  }
}
const canConfirmReset = computed(() => resetConfirm.value === '重置')
function reset() {
  if (props.disabled || !canConfirmReset.value) return
  emit(
    'apply',
    {
      config: globalDefaultConfig(props.baseline),
      retainedSources: props.baseline.integrations.length,
      restrictedModules: [],
    },
    'reset',
  )
  resetting.value = false
}
async function download() {
  if (working.value) return
  working.value = true
  error.value = ''
  try {
    const query: Record<string, string> = {}
    if (includeCredentials.value) query.credentials = '1'
    if (includeHistory.value) query.history = '1'
    const backup = await $fetch<ConfigBackup>('/api/admin/data/export', { query })
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'nozoki-config-' + backup.exportedAt.slice(0, 10) + '.json'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showExportFeedback('导出成功', 'success')
  } catch (e) {
    error.value =
      (e as { data?: { code?: string } }).data?.code === 'CREDENTIAL_DECRYPT_FAILED'
        ? '无法解密全部来源凭据，请检查此部署的密钥环后重试。'
        : '导出失败，请确认登录状态后重试；配置变化时请重新导出。'
    showExportFeedback('导出失败', 'error')
  } finally {
    working.value = false
  }
}
</script>
<template>
  <div class="data-management">
    <section class="data-management-card">
      <h3><CommonAppIcon name="FileDownloadRound" />数据导出</h3>
      <p>导出当前配置与背景图片，可按需包含来源凭据与采集历史。</p>
      <div class="data-export-options">
        <VarCheckbox v-model="includeCredentials">包含凭据</VarCheckbox>
        <VarCheckbox v-model="includeHistory">包含采集历史</VarCheckbox>
      </div>
      <p v-if="includeCredentials" class="source-warning">
        文件含明文机密，请妥善保管并在导入完成后删除。
      </p>
      <p v-if="includeHistory" class="admin-note">
        采集历史仅用于归档，无法导入新部署；如需保留请在重置前导出。
      </p>
      <VarButton type="primary" tonal :loading="working" :disabled="working" @click="download"
        >导出配置</VarButton
      >
    </section>
    <section class="data-management-card">
      <h3><CommonAppIcon name="FileUploadRound" />数据导入</h3>
      <p>选择 Nozoki 导出的 JSON 文件，检查后加入草稿。保存配置后生效。</p>
      <input
        ref="fileInput"
        class="sr-only"
        type="file"
        accept="application/json,.json"
        aria-label="选择配置备份文件"
        :disabled="disabled || working"
        @change="chooseFile"
      />
      <VarButton type="primary" tonal :disabled="disabled || working" @click="fileInput?.click()"
        >选择配置文件</VarButton
      >
    </section>
    <section class="data-management-card">
      <h3><CommonAppIcon name="restore" />重置全局默认设置</h3>
      <p>恢复共享配置默认值，并清除全部来源凭据与采集历史。</p>
      <VarButton type="danger" tonal :disabled="disabled || working" @click="openReset"
        >恢复全局默认设置</VarButton
      >
    </section>
    <p v-if="error" role="alert" class="source-warning">{{ error }}</p>
    <p v-if="importProgress" role="status">{{ importProgress }}</p>
    <VarPopup
      v-model:show="exportFeedbackOpen"
      position="bottom"
      class="admin-feedback-popup"
      role="status"
      aria-live="polite"
      :overlay="false"
      :lock-scroll="false"
      :default-style="false"
      :close-on-key-escape="false"
    >
      <p class="admin-feedback-toast data-export-feedback" :data-tone="exportTone">
        {{ exportFeedback }}
      </p>
    </VarPopup>
    <AdminSourceDialog
      v-model:show="importing"
      title="导入配置预览"
      :confirm="pendingCredentialTests ? '验证并继续' : '导入到草稿'"
      :blocked="!canApply"
      @confirm="applyImport"
      @closed="wipe"
    >
      <template v-if="plan">
        <p v-if="importProgress" role="status">{{ importProgress }}</p>
        <p>站点：{{ plan.config.site.siteName }}</p>
        <p>
          {{ plan.config.modules.length }} 个模块 · {{ plan.config.links.length }} 个链接 ·
          {{ plan.config.quotes.length }} 个行情标的
        </p>
        <p v-if="plan.adjustedIntervals">
          已将 {{ plan.adjustedIntervals }} 个旧刷新间隔调整为 300 秒。
        </p>
        <p v-if="plan.retainedSources">
          保留并停用 {{ plan.retainedSources }} 个备份未包含的来源。
        </p>
        <p v-if="plan.restrictedModules.length" class="source-warning">
          无法安全复用备份中的条目权限，已将
          {{ plan.restrictedModules.join('、') }} 设为仅管理员可见，请在保存后检查权限。
        </p>
        <p v-if="dirty" class="source-warning">导入将替换当前未保存修改。</p>
        <p v-if="importSummary.passed || importSummary.failed" role="status">
          验证通过 {{ importSummary.passed }} 项 · 凭据未迁移 {{ importSummary.failed }} 项
        </p>
        <p v-for="(message, id) in importResults" :key="id" role="status">
          {{ importSourceName(id) }}：{{ message }}
        </p>
        <p v-if="tests.length">请先验证以下来源，或选择暂不导入。</p>
        <section v-for="source in tests" :key="source.id" class="data-import-source">
          <h3>{{ integrationPreset(source)?.name ?? '旧来源' }}</h3>
          <AdminIntegrationEditor
            v-model="
              plan.config.integrations[
                plan.config.integrations.findIndex((s) => s.id === source.id)
              ]!
            "
            :timezone="plan.config.site.timezone"
            :saved="baseline.integrations.find((s) => s.id === source.id)"
            :expected-version="baseline.site.configVersion"
            :quote-symbols="symbols(source.id)"
          />
          <VarButton tonal @click="skipSource(source.id)">{{
            baseline.integrations.some((s) => s.id === source.id)
              ? '保留现有来源'
              : '暂不导入此来源'
          }}</VarButton>
        </section>
        <p class="admin-note">仅替换配置草稿；保存前可通过“放弃修改”撤销。</p>
      </template>
    </AdminSourceDialog>
    <AdminSourceDialog
      v-model:show="resetting"
      title="恢复全局默认设置？"
      confirm="确认恢复默认"
      danger
      :blocked="disabled || !canConfirmReset"
      @confirm="reset"
    >
      <p>恢复站点、外观、模块和行情默认值，移除自定义日程、链接和旧版高级限制，撤下已上传背景。</p>
      <p>自建来源停用并清除其凭据；腾讯行情恢复默认。</p>
      <p class="source-warning">将一并清除（不可恢复）：</p>
      <ul v-if="historyCounts" class="data-purge-list">
        <li>余额观测 {{ historyCounts.balanceObservations }} 条</li>
        <li>每日用量 {{ historyCounts.dailyUsage }} 条</li>
        <li>Codex 日用量 {{ historyCounts.codexUsageDays }} 条</li>
        <li>采集记录 {{ historyCounts.collectionRuns }} 条</li>
        <li>快照 {{ historyCounts.snapshotViews }} 份</li>
        <li>服务探测快照 {{ historyCounts.serviceObservations }} 份</li>
        <li>服务心跳窗口 {{ historyCounts.serviceHeartbeatWindows }} 份</li>
      </ul>
      <p v-else class="admin-note">统计暂时不可用，清除范围与上一致。</p>
      <p>需要保留时请先返回导出「包含采集历史」的备份。</p>
      <p v-if="dirty" class="source-warning">当前未保存修改也会被替换。</p>
      <p>输入「重置」以确认：</p>
      <VarInput v-model="resetConfirm" placeholder="重置" aria-label="输入重置确认文字" />
      <p>确认后立即保存并生效。</p>
    </AdminSourceDialog>
  </div>
</template>
