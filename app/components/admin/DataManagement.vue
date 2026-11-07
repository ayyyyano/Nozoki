<script setup lang="ts">
import { editableConfig } from '../../../shared/contracts/admin'
import type { Config } from '../../../shared/contracts/config'
import type { ConfigBackup } from '../../../shared/contracts/config-backup'
import { BACKUP_FILE_LIMIT } from '../../../shared/contracts/config-backup'
import {
  prepareConfigImport,
  globalDefaultConfig,
  type ConfigImportPlan,
} from '../../../shared/domain/config-backup'
import { requiresSourceTest } from '../../../shared/integration-presets/connection'
import { integrationPreset } from '../../../shared/integration-presets'
import { bindSources } from '../../../shared/integration-presets/bindings'

const props = defineProps<{ baseline: Config; disabled: boolean; dirty: boolean }>()
const emit = defineEmits<{ apply: [ConfigImportPlan, 'import' | 'reset'] }>()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const importing = ref(false),
  resetting = ref(false),
  working = ref(false)
const plan = ref<ConfigImportPlan | null>(null),
  error = ref('')
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
}
onBeforeUnmount(wipe)
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
      (s) => !!s.connectionProof && Number(s.connectionProof.split('.')[0]) > clock.value,
    ),
)
const importErrors: Record<string, string> = {
  BACKUP_TOO_LARGE: '配置文件过大，请减少配置内容或压缩背景图片后重试。',
  BACKUP_INVALID_IMAGE: '备份中的背景图片缺失或校验不通过。',
  BACKUP_DUPLICATE_SOURCE: '备份包含重复的数据源类型，请整理后重试。',
  BACKUP_UNSUPPORTED_SOURCE: '备份包含当前站点无法兼容的旧协议来源。',
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
    if (file.size > BACKUP_FILE_LIMIT) throw new Error('BACKUP_TOO_LARGE')
    const prepared = await prepareConfigImport(await file.text(), props.baseline)
    if (revision !== generation) return
    plan.value = prepared
    importing.value = true
  } catch (e) {
    if (revision === generation)
      error.value =
        importErrors[(e as Error).message] ?? '无法读取此配置文件。请检查文件格式、版本及配置内容。'
  } finally {
    working.value = false
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
function applyImport() {
  if (!plan.value || !canApply.value) return
  const prepared = plan.value
  plan.value = null
  emit('apply', prepared, 'import')
  importing.value = false
}
function reset() {
  if (props.disabled) return
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
    const backup = await $fetch<ConfigBackup>('/api/admin/data/export')
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
  } catch {
    error.value = '导出失败，请确认登录状态后重试；配置变化时请重新导出。'
  } finally {
    working.value = false
  }
}
</script>
<template>
  <div class="data-management">
    <section class="data-management-card">
      <h3><CommonAppIcon name="FileDownloadRound" />数据导出</h3>
      <p>下载已保存的站点、外观、模块、日程、行情、链接及来源配置，包含已上传的共享背景。</p>
      <p class="admin-note">
        不包含当前草稿、登录密钥、数据源密钥和采集历史。文件包含服务地址与权限设置，请妥善保管。
      </p>
      <VarButton type="primary" tonal :loading="working" :disabled="working" @click="download"
        >导出配置</VarButton
      >
    </section>
    <section class="data-management-card">
      <h3><CommonAppIcon name="FileUploadRound" />数据导入</h3>
      <p>
        选择 Nozoki 导出的 JSON
        文件，确认预览后加入草稿。新增或更改地址的来源须先测试，再点击顶栏“保存配置”生效。
      </p>
      <p class="admin-note">
        同地址的现有密钥可继续使用；其他来源需重新填写密钥。备份未包含的现有来源会停用并保留。
      </p>
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
      <p>
        恢复默认站点、外观、模块、日程、行情和常用链接。自建来源停用，保留其密钥与历史；现有且已批准的腾讯来源恢复启用。
      </p>
      <p class="admin-note">
        不会删除数据库、采集历史或退出登录，不会重新添加已删除的来源。确认后替换当前草稿，保存配置后生效。
      </p>
      <VarButton type="danger" tonal :disabled="disabled || working" @click="resetting = true"
        >恢复全局默认设置</VarButton
      >
    </section>
    <p v-if="error" role="alert" class="source-warning">{{ error }}</p>
    <AdminSourceDialog
      v-model:show="importing"
      title="导入配置预览"
      confirm="导入到草稿"
      :blocked="!canApply"
      @confirm="applyImport"
      @closed="wipe"
    >
      <template v-if="plan">
        <p>站点：{{ plan.config.site.siteName }}</p>
        <p>
          {{ plan.config.modules.length }} 个模块 · {{ plan.config.links.length }} 个链接 ·
          {{ plan.config.quotes.length }} 个行情标的
        </p>
        <p v-if="plan.retainedSources">
          保留并停用 {{ plan.retainedSources }} 个备份未包含的来源。
        </p>
        <p v-if="plan.restrictedModules.length" class="source-warning">
          无法安全复用备份中的条目权限，已将
          {{ plan.restrictedModules.join('、') }} 设为仅管理员可见，请在保存后检查权限。
        </p>
        <p v-if="dirty" class="source-warning">导入将替换当前未保存修改。</p>
        <p v-if="tests.length">请完成以下来源测试，或选择暂不导入。测试不会保存配置或采集快照。</p>
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
      :blocked="disabled"
      @confirm="reset"
    >
      <p>
        恢复站点及所有模块的默认设置，移除自定义日程和链接，撤下已上传背景。自建来源停用，密钥、历史记录和登录状态保留。
      </p>
      <p v-if="dirty" class="source-warning">当前未保存修改也会被替换。</p>
      <p>这一步只修改草稿，点击顶栏“保存配置”后生效。</p>
    </AdminSourceDialog>
  </div>
</template>
