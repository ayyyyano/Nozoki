<script setup lang="ts">
import type { SessionDto, CsrfDto } from '../../shared/contracts/auth'
import {
  ConfigSchema,
  SaveConfigSchema,
  type Config,
  type ConfigWrite,
} from '../../shared/contracts/config'
import { editableConfig, canonical } from '../../shared/contracts/admin'
import { SOURCE_WRITE_ERRORS } from '../../shared/integration-presets'
import { COLOR_PRESETS, parseSourceColor } from '../../shared/domain/color-input'
import type { Appearance } from '../../shared/contracts/appearance'
import {
  defaultSectionPatch,
  sectionResetIssue,
  type AdminSection,
} from '../../shared/domain/admin-reset'
const { data: session, refresh: refreshSession } = await useFetch<SessionDto>('/api/auth/session', {
  key: 'admin-session',
})
if (session.value?.viewer !== 'admin') await navigateTo('/login')
const readOnly = useState('admin-storage-read-only', () => false)
const { data: initial } = await useFetch<Config>('/api/admin/config', {
  key: 'admin-config',
  onResponse({ response }) {
    if (response.ok) readOnly.value = response.headers.get('X-Nozoki-Storage-Mode') === 'read-only'
  },
})
const shared = useSharedDashboard()
const themeControl = inject<{ dark: Ref<boolean>; ready: Ref<boolean>; toggleTheme: () => void }>(
  'themeControl',
)!
const themeLabel = computed(() =>
  themeControl.ready.value
    ? themeControl.dark.value
      ? '切换到亮色模式'
      : '切换到暗色模式'
    : '切换明暗模式',
)
const baseline = ref<Config | null>(initial.value ? ConfigSchema.parse(initial.value) : null)
const draft = ref<ConfigWrite | null>(baseline.value ? editableConfig(baseline.value) : null)
const section = ref('site'),
  busy = ref(false),
  message = ref(''),
  errors = ref<string[]>([]),
  conflict = ref(false),
  showDiscard = ref(false),
  showLatest = ref(false),
  savedNeedsReload = ref(false),
  latest = ref<Config | null>(null),
  preview = ref(false)
const sections = [
  { id: 'site', label: '站点与外观', icon: 'tune' },
  { id: 'modules', label: 'Dashboard 模块', icon: 'devices' },
  { id: 'integrations', label: '数据源', icon: 'server' },
  { id: 'schedule', label: '日程安排', icon: 'clock' },
  { id: 'quotes', label: '行情标的', icon: 'chart' },
  { id: 'links', label: '常用链接', icon: 'link' },
] as const
const currentSection = computed(
  () => sections.find((item) => item.id === section.value) ?? sections[0],
)
const showReset = ref(false)
const resetTarget = ref<(typeof sections)[number]>(sections[0])
const resetIssue = computed(() =>
  draft.value ? sectionResetIssue(draft.value, resetTarget.value.id) : null,
)
const resetDescriptions: Record<AdminSection, string> = {
  site: '恢复默认站点名称、主题色和背景。日程与浏览器个人偏好保持当前值。',
  modules: '恢复各模块的启停、标题、顺序、权限和来源引用。Tailscale 默认关闭。',
  integrations:
    '恢复腾讯默认来源，移除其他来源及其凭据配置。已有历史记录的来源可能受删除保护限制。',
  schedule: '恢复默认时区、工作时间和休息日规则，移除自定义周计划、模板及日期例外。',
  quotes: '恢复 QQQM、VOO 默认标的，移除其他标的。',
  links: '恢复默认的博客、项目、主页和关于链接。',
}
function requestReset() {
  if (busy.value || !draft.value) return
  resetTarget.value = currentSection.value
  showReset.value = true
}
function resetCurrentSection() {
  if (busy.value || !draft.value || resetIssue.value) return
  const target = resetTarget.value.id
  const patch = defaultSectionPatch(draft.value, target)
  if (target === 'integrations') clearSecrets()
  Object.assign(draft.value, patch)
  if (target === 'site') preview.value = false
  if (target === 'schedule') scheduleDraftReset.value++
  if (target === 'links') expandedLinks.value = {}
  if (target === 'quotes') expandedQuotes.value = {}
  if (target === 'modules') expandedModules.value = {}
  pending = null
  errors.value = []
  message.value = `已恢复${resetTarget.value.label}默认设置，保存配置后生效`
  showReset.value = false
}
const navigation = useTemplateRef('navigation')
const scheduleDraftReset = ref(0)
const showActions = ref(false)
const actionsPanel = useTemplateRef<HTMLElement>('actionsPanel')
const showFeedback = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
watch([message, errors], () => {
  clearTimeout(feedbackTimer)
  showFeedback.value = Boolean(message.value || errors.value.length)
  if (showFeedback.value && !errors.value.length && !conflict.value && !savedNeedsReload.value)
    feedbackTimer = setTimeout(() => {
      showFeedback.value = false
    }, 4000)
})
const returnActionsFocus = ref(true)
function focusActions() {
  actionsPanel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}
function actionKeys(event: KeyboardEvent) {
  const items = [
    ...(actionsPanel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Tab') showActions.value = false
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
let afterActions: (() => void) | null = null
function actionsClosed() {
  if (returnActionsFocus.value)
    document.querySelector<HTMLButtonElement>('.admin-more-trigger')?.focus()
  const action = afterActions
  afterActions = null
  action?.()
}
function discardFromMenu() {
  afterActions = () => (showDiscard.value = true)
  showActions.value = false
}
function logoutFromMenu() {
  afterActions = () => {
    void logout()
  }
  showActions.value = false
}
function dashboardFromMenu() {
  afterActions = () => {
    void navigateTo('/', { external: true })
  }
  showActions.value = false
}
function themeFromMenu() {
  themeControl.toggleTheme()
  showActions.value = false
}
const expandedLinks = ref<Record<string, boolean>>({})
const expandedQuotes = ref<Record<string, boolean>>({})
const sourceManager = useTemplateRef('sourceManager')
const expandedModules = ref<Record<string, boolean>>({})
function linkSummary(url: string) {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}
const dirty = computed(
  () =>
    !!draft.value &&
    !!baseline.value &&
    canonical(draft.value) !== canonical(editableConfig(baseline.value)),
)
const adminPreview = useState<Pick<Appearance, 'sourceColor' | 'background'> | null>(
  'nozoki-admin-preview',
  () => null,
)
const reloadDashboard = inject<() => Promise<void>>('reloadDashboard')!
const notifyDashboardSaved = inject<() => void>('notifyDashboardSaved')!
watch(
  [draft, preview],
  () => {
    const color = parseSourceColor(draft.value?.site.appearance.sourceColor)
    adminPreview.value =
      preview.value && draft.value && color
        ? { sourceColor: color, background: structuredClone(toRaw(draft.value.site.background)) }
        : null
  },
  { deep: true },
)
useHead({ title: '站点管理 · Nozoki' })
let pending: { key: string; signature: string } | null = null
function clearSecrets() {
  if (draft.value)
    for (const i of draft.value.integrations) {
      if (i.credential.operation === 'replace') i.credential.value = ''
      delete i.identityCredential
    }
}
function accept(config: Config) {
  clearSecrets()
  baseline.value = ConfigSchema.parse(config)
  draft.value = editableConfig(baseline.value)
  scheduleDraftReset.value++
  pending = null
  conflict.value = false
  errors.value = []
  preview.value = false
  savedNeedsReload.value = false
}
function locate(error: string) {
  section.value = error.includes('schedule')
    ? 'schedule'
    : error.includes('modules')
      ? 'modules'
      : error.includes('integrations')
        ? 'integrations'
        : error.includes('quotes')
          ? 'quotes'
          : error.includes('links')
            ? 'links'
            : 'site'
  if (draft.value) {
    draft.value.links.forEach((l) => (expandedLinks.value[l.id] = true))
    draft.value.modules.forEach((m) => (expandedModules.value[m.id] = true))
    sourceManager.value?.expandAll()
    draft.value.quotes.forEach((_, i) => (expandedQuotes.value[String(i)] = true))
  }
  nextTick(() =>
    document
      .querySelector<HTMLElement>('.admin-form fieldset:not([style*="display: none"]) input')
      ?.focus(),
  )
}
function acceptLatest() {
  if (latest.value) accept(latest.value)
  showLatest.value = false
}
async function loadLatest() {
  try {
    const response = await $fetch.raw<Config>('/api/admin/config')
    readOnly.value = response.headers.get('X-Nozoki-Storage-Mode') === 'read-only'
    latest.value = response._data ?? null
    showLatest.value = true
  } catch {
    message.value = '读取最新配置失败，请确认登录状态后重试'
  }
}
async function save() {
  if (busy.value || !draft.value || readOnly.value) return
  errors.value = []
  message.value = ''
  conflict.value = false
  draft.value.site.timezone = draft.value.site.schedule.timezone
  draft.value.links.forEach((link) => (link.visibility = 'public'))
  const parsed = SaveConfigSchema.safeParse({
    expectedVersion: baseline.value!.site.configVersion,
    config: draft.value,
  })
  if (!parsed.success) {
    errors.value = parsed.error.issues.map((i) => i.path.join('.') + '：' + i.message)
    message.value = '未保存，请检查以下字段'
    await nextTick()
    document.querySelector<HTMLElement>('.admin-feedback')?.focus()
    return
  }
  const signature = canonical(parsed.data)
  if (!pending || pending.signature !== signature) pending = { key: crypto.randomUUID(), signature }
  busy.value = true
  try {
    const csrf = await $fetch<CsrfDto>('/api/auth/csrf')
    const result = await $fetch<{ collection?: 'scheduled' | 'not_needed' | 'deferred' }>(
      '/api/admin/config',
      {
        method: 'PUT',
        headers: { 'X-Nozoki-CSRF': csrf.token, 'Idempotency-Key': pending.key },
        body: parsed.data,
      },
    )
    // Release plaintext before any subsequent request; do not retain it in a retry signature.
    clearSecrets()
    pending = null
    savedNeedsReload.value = true
    notifyDashboardSaved()
    const saved = await $fetch<Config>('/api/admin/config')
    accept(saved)
    await reloadDashboard()
    message.value =
      result.collection === 'scheduled'
        ? '配置已保存，已安排数据更新；结果将在采集完成后显示'
        : result.collection === 'deferred'
          ? '配置已保存，数据更新将由定时任务重试'
          : '已保存并确认持久化'
  } catch (error) {
    const data = (error as { data?: { code?: string; fieldErrors?: string[]; reason?: string } })
      .data
    if (data?.code === 'MIGRATIONS_REQUIRED') readOnly.value = true
    conflict.value = data?.code === 'CONFIG_CONFLICT'
    errors.value = data?.fieldErrors ?? []
    message.value = savedNeedsReload.value
      ? '配置已保存，但重新读取失败；请读取最新配置确认。凭据输入已清除。'
      : data?.reason && data.reason in SOURCE_WRITE_ERRORS
        ? SOURCE_WRITE_ERRORS[data.reason as keyof typeof SOURCE_WRITE_ERRORS]
        : conflict.value
          ? '配置已被其他窗口修改。草稿已保留，请读取最新版本后决定如何处理。'
          : data?.code === 'MIGRATIONS_REQUIRED'
            ? '数据库等待迁移，已暂停保存。草稿已保留，完成迁移后请读取最新配置。'
            : data?.reason === 'CREDENTIAL_KEY_UNAVAILABLE'
              ? '未配置服务端集成加密密钥；请配置本地密钥后重试，凭据不会明文保存。'
              : data?.reason === 'IDENTITY_IMPORT_UNVERIFIED'
                ? '旧账户身份密钥未通过核对。请检查原 Relay 密钥、Management Key 和来源地址；现有权限与配置未更改。'
                : data?.code === 'VALIDATION_ERROR'
                  ? '配置校验未通过。请检查字段、来源引用和地址变化后的凭据操作。'
                  : '未能确认保存结果。草稿已保留；原样重试会复用请求标识。'
  } finally {
    busy.value = false
  }
}
function discard() {
  if (baseline.value) accept(baseline.value)
  showDiscard.value = false
  message.value = '已放弃未保存修改'
}
function move<T extends { sortOrder: number }>(items: T[], index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= items.length) return
  ;[items[index], items[target]] = [items[target]!, items[index]!]
  items.forEach((item, i) => (item.sortOrder = i))
}
function makePrivate(module: ConfigWrite['modules'][number]) {
  if (module.visibility === 'admin')
    for (const policy of Object.values(module.fields)) policy.visibility = 'admin'
}
function addQuote() {
  expandedQuotes.value[String(draft.value!.quotes.length)] = true
  draft.value!.quotes.push({
    market: 'US',
    symbol: 'NEW',
    displayName: '新标的',
    provider: null,
    sortOrder: draft.value!.quotes.length,
    enabled: true,
    refreshInterval: 300,
  })
}
function addLink() {
  const id = 'link-' + crypto.randomUUID().slice(0, 8)
  expandedLinks.value[id] = true
  draft.value!.links.push({
    id,
    title: '新链接',
    url: 'https://example.com/',
    icon: 'link',
    sortOrder: draft.value!.links.length,
    visibility: 'public',
    enabled: true,
  })
}
async function logout() {
  if (dirty.value) {
    message.value = '请先保存或放弃修改，再注销'
    return
  }
  try {
    const csrf = await $fetch<CsrfDto>('/api/auth/csrf')
    await $fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-Nozoki-CSRF': csrf.token },
      body: {},
    })
    clearNuxtData('admin-config')
    clearNuxtData('admin-session')
    clearNuxtData('dashboard')
    clearSecrets()
    shared.value = null
    await reloadDashboard()
    await navigateTo('/login', { external: true, replace: true })
  } catch {
    message.value = '注销失败，请重试'
  }
}
const confirmPanel = useTemplateRef<HTMLElement>('confirmPanel'),
  latestPanel = useTemplateRef<HTMLElement>('latestPanel'),
  resetPanel = useTemplateRef<HTMLElement>('resetPanel')
const discardFocus = useModalFocus(showDiscard, confirmPanel),
  latestFocus = useModalFocus(showLatest, latestPanel),
  resetFocus = useModalFocus(showReset, resetPanel)
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
async function checkSession() {
  try {
    await refreshSession()
  } catch {
    // A transient session check failure must not discard the current draft or redirect.
    return
  }
  if (session.value?.viewer !== 'admin') {
    clearSecrets()
    clearNuxtData('dashboard')
    shared.value = null
    await navigateTo('/login')
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('focus', checkSession)
})
onBeforeUnmount(() => {
  clearTimeout(feedbackTimer)
  afterActions = null
  clearSecrets()
  pending = null
  clearNuxtData('admin-config')
  adminPreview.value = null
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('focus', checkSession)
})
onBeforeRouteLeave(() => {
  if (dirty.value && !confirm('存在未保存修改，确定离开？')) return false
})
</script>
<template>
  <main id="main-content" class="admin-page management-page" tabindex="-1">
    <div class="admin-shell">
      <header class="admin-toolbar">
        <VarButton
          class="admin-section-trigger admin-icon-button"
          text
          round
          aria-label="选择管理分区"
          title="打开管理分区"
          aria-haspopup="dialog"
          :aria-expanded="navigation?.show ?? false"
          @click="navigation?.open()"
          ><CommonAppIcon name="menu"
        /></VarButton>
        <div class="admin-toolbar-title">
          <h1>站点管理</h1>
          <small
            >{{ session?.viewer === 'admin' ? session.email : '' }}
            <span v-if="dirty" class="admin-dirty">· 未保存修改</span></small
          >
        </div>
        <span
          v-if="dirty"
          class="admin-dirty-dot"
          role="status"
          aria-label="未保存修改"
          title="未保存修改"
        ></span>
        <div class="admin-actions">
          <VarButton
            type="primary"
            class="admin-save"
            :aria-label="busy ? '保存中' : '保存配置'"
            :title="busy ? '保存中' : '保存配置'"
            :loading="busy"
            :disabled="busy || !draft || savedNeedsReload || readOnly"
            @click="save"
            ><CommonAppIcon name="save" :size="22" /><span class="admin-action-text">{{
              busy ? '保存中' : '保存配置'
            }}</span></VarButton
          >
          <VarMenu
            v-model:show="showActions"
            class="admin-more-menu"
            placement="bottom-end"
            strategy="fixed"
            :offset-y="6"
            :elevation="false"
            :default-style="false"
            :close-on-click-reference="true"
            :disabled="busy"
            @open="returnActionsFocus = true"
            @opened="focusActions"
            @closed="actionsClosed"
            @click-outside="returnActionsFocus = false"
          >
            <VarButton
              class="admin-more-trigger admin-icon-button"
              text
              round
              aria-label="更多管理操作"
              title="更多管理操作"
              aria-haspopup="menu"
              :aria-expanded="showActions"
              :disabled="busy"
              ><CommonAppIcon name="more"
            /></VarButton>
            <template #menu>
              <div
                ref="actionsPanel"
                class="admin-action-menu"
                role="menu"
                aria-label="更多管理操作"
                tabindex="-1"
                @keydown="actionKeys"
              >
                <VarButton role="menuitem" text :disabled="busy" @click="dashboardFromMenu"
                  ><CommonAppIcon name="home" :size="20" />返回看板</VarButton
                >
                <VarButton role="menuitem" text @click="themeFromMenu"
                  ><span class="theme-icon-light"><CommonAppIcon name="moon" :size="20" /></span
                  ><span class="theme-icon-dark"><CommonAppIcon name="sun" :size="20" /></span
                  >{{ themeLabel }}</VarButton
                >
                <VarButton role="menuitem" text :disabled="busy || !dirty" @click="discardFromMenu"
                  ><CommonAppIcon name="undo" :size="20" />放弃修改</VarButton
                >
                <VarButton role="menuitem" text :disabled="busy" @click="logoutFromMenu"
                  ><CommonAppIcon name="logout" :size="20" />注销</VarButton
                >
              </div>
            </template>
          </VarMenu>
        </div>
      </header>
      <VarPopup
        v-model:show="showFeedback"
        position="bottom"
        class="admin-feedback-popup"
        role="status"
        aria-live="polite"
        aria-modal="false"
        :overlay="false"
        :lock-scroll="false"
        :default-style="false"
        :close-on-key-escape="false"
      >
        <section class="admin-feedback admin-feedback-toast" tabindex="-1">
          <p>{{ message }}</p>
          <ul v-if="errors.length">
            <li v-for="error in errors" :key="error">
              <button type="button" class="admin-error-link" @click="locate(error)">
                {{ error }}
              </button>
            </li>
          </ul>
          <VarButton v-if="conflict || savedNeedsReload" text @click="loadLatest"
            >读取服务器最新配置</VarButton
          >
        </section>
      </VarPopup>
      <div v-if="!draft" class="admin-feedback" role="alert">
        <p>配置读取失败，请检查连接或重新登录。</p>
        <VarButton text @click="loadLatest">重新读取配置</VarButton>
      </div>
      <div v-else class="admin-workspace">
        <AdminSectionNav ref="navigation" v-model="section" :sections="sections" />
        <form class="admin-form" @submit.prevent="save">
          <p v-if="readOnly" class="admin-storage-notice" role="status">
            数据库等待迁移，当前为只读模式。已有配置和看板数据保持可读；请完成数据库迁移后刷新页面。
          </p>
          <div class="admin-section-heading">
            <h2>{{ currentSection.label }}</h2>
            <VarButton
              text
              round
              class="admin-icon-button"
              :disabled="busy || readOnly"
              :aria-label="`重置${currentSection.label}为默认设置`"
              title="重置为默认设置"
              @click="requestReset"
            >
              <CommonAppIcon name="restore" />
            </VarButton>
          </div>
          <fieldset v-show="section === 'site'" :disabled="readOnly">
            <legend class="sr-only">站点与外观</legend>
            <AdminText v-model="draft.site.siteName" label="站点名称" :max="100" />
            <div class="palette-presets">
              <VarButton
                v-for="preset in COLOR_PRESETS"
                :key="preset.color"
                text
                round
                :aria-label="`共享配色 ${preset.name}`"
                :aria-pressed="draft.site.appearance.sourceColor === preset.color"
                :style="{ '--swatch': preset.color }"
                @click="draft.site.appearance.sourceColor = preset.color"
                ><span class="palette-swatch"
                  ><CommonAppIcon
                    v-if="draft.site.appearance.sourceColor === preset.color"
                    name="check"
                    :size="20" /></span
              ></VarButton>
            </div>
            <AdminText
              v-model="draft.site.appearance.sourceColor"
              label="共享主题源色 HEX / RGB"
              :max="40"
            /><label
              ><VarSwitch
                v-model="preview"
                aria-label="预览共享外观"
              />预览共享外观（不保存个人偏好）</label
            ><AdminBackgroundEditor v-model="draft.site.background" />
          </fieldset>
          <fieldset v-show="section === 'modules'" :disabled="readOnly">
            <legend class="sr-only">Dashboard 模块</legend>
            <AdminEditorItem
              v-for="(m, index) in draft.modules"
              :key="m.id"
              v-model:open="expandedModules[m.id]"
              :title="m.title"
              :description="m.id"
              :status="!m.enabled ? '已关闭' : m.visibility === 'public' ? '公开' : '管理员'"
              :data-edit-module="m.id"
              icon="devices"
            >
              <template #actions>
                <VarButton
                  text
                  :disabled="index === 0"
                  :aria-label="`上移 ${m.id}`"
                  @click="move(draft.modules, index, -1)"
                  >上移</VarButton
                ><VarButton
                  text
                  :disabled="index === draft.modules.length - 1"
                  :aria-label="`下移 ${m.id}`"
                  @click="move(draft.modules, index, 1)"
                  >下移</VarButton
                >
              </template>
              <div class="admin-fields">
                <AdminText v-model="m.title" :label="`${m.id} 标题`" :max="100" /><label
                  ><VarSwitch v-model="m.enabled" :aria-label="`启用 ${m.id}`" />启用</label
                ><VarSelect
                  v-model="m.visibility"
                  :aria-label="`${m.id} 模块权限`"
                  placeholder="模块权限"
                  variant="outlined"
                  @update:model-value="makePrivate(m)"
                  ><VarOption label="公开" value="public" /><VarOption
                    label="管理员"
                    value="admin" /></VarSelect
                ><VarSelect
                  v-model="m.guestBehavior"
                  :aria-label="`${m.id} 访客行为`"
                  placeholder="访客行为"
                  variant="outlined"
                  ><VarOption label="隐藏" value="hidden" /><VarOption
                    label="登录提示"
                    value="login_hint"
                /></VarSelect>
              </div>
              <label v-if="m.id === 'deepseek'">
                <VarSwitch
                  v-model="m.guestBlur"
                  aria-label="DeepSeek 未登录时模糊展示"
                />未登录时模糊展示余额（保留卡片）
              </label>
              <VarSelect
                v-if="m.id === 'tailscale'"
                v-model="m.ipVisibility"
                aria-label="Tailscale IP 显示"
                placeholder="IP 显示"
                variant="outlined"
              >
                <VarOption label="显示" value="public" /><VarOption
                  label="不显示"
                  value="hidden"
                /><VarOption label="登录后显示" value="admin" />
              </VarSelect>
              <details class="admin-details">
                <summary>数据源引用</summary>
                <div
                  v-for="(s, key) in Object.fromEntries(
                    Object.entries(m.sources).filter(
                      ([key]) => m.id !== 'deepseek' || key === 'main',
                    ),
                  )"
                  :key="key"
                  class="admin-fields"
                >
                  <span>{{ key }}</span
                  ><VarSelect
                    v-model="s.sourceId"
                    :aria-label="`${m.id} ${key} 来源`"
                    placeholder="来源 ID"
                    variant="outlined"
                    ><VarOption
                      v-for="i in draft.integrations"
                      :key="i.id"
                      :label="i.id"
                      :value="i.id" /></VarSelect
                  ><AdminText v-model="s.subject" :label="`${m.id} ${key} subject`" /><VarButton
                    text
                    @click="delete m.sources[key]"
                    >移除引用</VarButton
                  >
                </div>
                <VarButton
                  text
                  :disabled="!draft.integrations.length || !!m.sources.main"
                  @click="
                    m.sources.main = { sourceId: draft.integrations[0]!.id, subject: 'default' }
                  "
                  >添加 main 引用</VarButton
                >
              </details>
              <AdminFieldEditor v-model="draft.modules[index]!" />
            </AdminEditorItem>
          </fieldset>
          <fieldset v-show="section === 'integrations'" :disabled="readOnly">
            <legend class="sr-only">数据源</legend>
            <AdminSourceManager
              ref="sourceManager"
              v-model="draft.integrations"
              :saved="baseline?.integrations ?? []"
              :modules="draft.modules"
              :quotes="draft.quotes"
              :timezone="draft.site.timezone"
              :read-only="readOnly"
            />
          </fieldset>
          <fieldset v-show="section === 'schedule'" :disabled="readOnly">
            <legend class="sr-only">日程安排</legend>
            <AdminScheduleEditor v-model="draft.site.schedule" :reset-token="scheduleDraftReset" />
          </fieldset>
          <fieldset v-show="section === 'quotes'" :disabled="readOnly">
            <legend class="sr-only">行情标的</legend>
            <AdminEditorItem
              v-for="(q, index) in draft.quotes"
              :key="index"
              v-model:open="expandedQuotes[String(index)]"
              :title="q.symbol"
              :description="q.displayName"
              :status="q.enabled ? q.market : '已关闭'"
              icon="chart"
            >
              <div class="admin-fields">
                <AdminText v-model="q.market" :label="`标的 ${index + 1} 市场`" /><AdminText
                  v-model="q.symbol"
                  :label="`标的 ${index + 1} 代码`"
                /><AdminText v-model="q.displayName" :label="`标的 ${index + 1} 名称`" /><VarSelect
                  v-model="q.provider"
                  :aria-label="`标的 ${index + 1} Provider`"
                  placeholder="供应商槽位"
                  variant="outlined"
                  ><VarOption label="未选定" :value="null" /><VarOption
                    v-for="i in draft.integrations.filter((i) => i.provider === 'quotes-custom')"
                    :key="i.id"
                    :label="i.id"
                    :value="i.id" /></VarSelect
                ><AdminNumber
                  v-model="q.refreshInterval"
                  :label="`标的 ${index + 1} 刷新间隔`"
                /><label
                  ><VarSwitch
                    v-model="q.enabled"
                    :aria-label="`启用标的 ${index + 1}`"
                  />启用</label
                >
              </div>
              <div class="admin-actions">
                <VarButton text :disabled="index === 0" @click="move(draft.quotes, index, -1)"
                  >上移标的 {{ index + 1 }}</VarButton
                ><VarButton
                  text
                  :disabled="index === draft.quotes.length - 1"
                  @click="move(draft.quotes, index, 1)"
                  >下移标的 {{ index + 1 }}</VarButton
                ><VarButton text @click="draft.quotes.splice(index, 1)"
                  >删除标的 {{ index + 1 }}</VarButton
                >
              </div>
            </AdminEditorItem>
            <VarButton
              class="admin-add-button"
              type="primary"
              tonal
              :disabled="draft.quotes.length >= 20"
              @click="addQuote"
              ><CommonAppIcon name="AddRound" :size="20" />添加行情标的</VarButton
            >
          </fieldset>
          <fieldset v-show="section === 'links'" :disabled="readOnly">
            <legend class="sr-only">常用链接</legend>
            <AdminEditorItem
              v-for="(l, index) in draft.links"
              :key="l.id"
              v-model:open="expandedLinks[l.id]"
              :title="l.title"
              :description="linkSummary(l.url)"
              :icon="l.icon"
              :status="l.enabled ? '启用' : '已关闭'"
              :data-edit-link="l.id"
            >
              <div class="admin-fields">
                <AdminText v-model="l.title" :label="`链接 ${index + 1} 名称`" /><AdminText
                  v-model="l.url"
                  :label="`链接 ${index + 1} URL`"
                /><AdminLinkIconInput v-model="l.icon" :label="`链接 ${index + 1} 图标`" />
                <label
                  ><VarSwitch
                    v-model="l.enabled"
                    :aria-label="`启用链接 ${index + 1}`"
                  />启用</label
                >
              </div>
              <div class="admin-actions">
                <VarButton text :disabled="index === 0" @click="move(draft.links, index, -1)"
                  >上移链接 {{ index + 1 }}</VarButton
                ><VarButton
                  text
                  :disabled="index === draft.links.length - 1"
                  @click="move(draft.links, index, 1)"
                  >下移链接 {{ index + 1 }}</VarButton
                ><VarButton text @click="draft.links.splice(index, 1)"
                  >删除链接 {{ index + 1 }}</VarButton
                >
              </div>
            </AdminEditorItem>
            <VarButton
              class="admin-add-button"
              type="primary"
              tonal
              :disabled="draft.links.length >= 100"
              @click="addLink"
              ><CommonAppIcon name="AddRound" :size="20" />添加链接</VarButton
            >
          </fieldset>
        </form>
      </div>
    </div>
    <VarPopup
      v-model:show="showReset"
      position="center"
      :default-style="false"
      :close-on-key-escape="true"
      @closed="resetFocus.restoreFocus"
    >
      <section
        ref="resetPanel"
        class="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        aria-describedby="reset-description"
        tabindex="-1"
      >
        <h2 id="reset-title">恢复{{ resetTarget.label }}默认设置？</h2>
        <p id="reset-description">{{ resetDescriptions[resetTarget.id] }}</p>
        <p>确认后仅修改本分区草稿，点击“保存配置”后生效。</p>
        <p v-if="resetIssue" role="alert">{{ resetIssue }}</p>
        <VarButton text @click="showReset = false">取消</VarButton>
        <VarButton text type="primary" :disabled="busy || !!resetIssue" @click="resetCurrentSection"
          >恢复默认</VarButton
        >
      </section>
    </VarPopup>
    <VarPopup
      v-model:show="showDiscard"
      position="center"
      :default-style="false"
      :close-on-key-escape="true"
      @closed="discardFocus.restoreFocus"
      ><section
        ref="confirmPanel"
        class="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        tabindex="-1"
      >
        <h2 id="discard-title">放弃未保存修改？</h2>
        <p>恢复本次读取的服务器配置。</p>
        <VarButton text type="primary" @click="discard">确认放弃</VarButton
        ><VarButton text @click="showDiscard = false">继续编辑</VarButton>
      </section></VarPopup
    >
    <VarPopup
      v-model:show="showLatest"
      position="center"
      :default-style="false"
      :close-on-key-escape="true"
      @closed="latestFocus.restoreFocus"
      ><section
        ref="latestPanel"
        class="admin-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="latest-title"
        tabindex="-1"
      >
        <h2 id="latest-title">服务器最新配置</h2>
        <p>版本 {{ latest?.site.configVersion }} · {{ latest?.site.siteName }}</p>
        <p>关闭可保留草稿；载入会明确放弃当前修改。</p>
        <VarButton text type="primary" @click="acceptLatest">放弃草稿并载入最新</VarButton
        ><VarButton text @click="showLatest = false">保留草稿</VarButton>
      </section></VarPopup
    >
  </main>
</template>
<style src="../assets/styles/management.css"></style>
