<script setup lang="ts">
import type { SessionDto, CsrfDto } from '../../../shared/contracts/auth'
const show = ref(false)
const shared = useSharedDashboard()
const session = shallowRef<SessionDto | null>(null)
const checking = ref(false)
const busy = ref(false)
const error = ref('')
const panel = useTemplateRef<HTMLElement>('panel')
const { restoreFocus } = useModalFocus(show, panel)
let request: AbortController | null = null
let run = 0
async function checkSession() {
  const current = ++run
  request?.abort()
  request = new AbortController()
  checking.value = true
  error.value = ''
  try {
    const result = await $fetch<SessionDto>('/api/auth/session', {
      signal: request.signal,
      timeout: 10000,
    })
    if (current !== run || !show.value) return
    session.value = result
    await nextTick()
    if (current === run && show.value)
      panel.value?.querySelector<HTMLInputElement>('input')?.focus()
  } catch {
    if (current === run && show.value) error.value = '暂时无法读取账户状态，请重试'
  } finally {
    if (current === run) checking.value = false
  }
}
function open() {
  if (show.value) return
  session.value = null
  show.value = true
  void checkSession()
}
function close() {
  if (!busy.value) show.value = false
}
async function logout() {
  if (busy.value) return
  busy.value = true
  error.value = ''
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
    session.value = { viewer: 'guest' }
    // A home page initially rendered for an administrator contains that admin projection
    // in the Nuxt payload. Clear client state and force a clean guest document so private
    // SSR data cannot remain inspectable after logout.
    shared.value = null
    await navigateTo('/', { external: true, replace: true })
  } catch {
    error.value = '注销未完成，请重试'
  } finally {
    busy.value = false
  }
}
watch(show, (value) => {
  if (!value) {
    ++run
    request?.abort()
    request = null
  }
})
onBeforeUnmount(() => {
  ++run
  request?.abort()
})
defineExpose({ open })
</script>
<template>
  <VarPopup
    v-model:show="show"
    position="center"
    :default-style="false"
    :close-on-key-escape="!busy"
    :close-on-click-overlay="!busy"
    @closed="restoreFocus"
  >
    <section
      ref="panel"
      class="account-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="session?.viewer === 'admin' ? '账户' : '管理员登录'"
      tabindex="-1"
    >
      <VarButton
        v-if="checking || !session || session.viewer === 'admin'"
        class="account-close"
        native-type="button"
        text
        round
        aria-label="关闭账户对话框"
        :disabled="busy"
        @click="close"
        ><CommonAppIcon name="close"
      /></VarButton>
      <div v-if="checking || !session" class="auth-card account-status">
        <h2>账户</h2>
        <p v-if="checking" role="status">正在读取账户状态…</p>
        <template v-else
          ><p role="alert">{{ error }}</p>
          <VarButton @click="checkSession">重试</VarButton></template
        >
      </div>
      <div v-else-if="session.viewer === 'admin'" class="auth-card account-status">
        <header class="auth-heading">
          <CommonAppIcon name="person" :size="28" />
          <h2>已登录</h2>
        </header>
        <p class="account-email">{{ session.email }}</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <VarButton :loading="busy" :disabled="busy" @click="logout">注销</VarButton>
      </div>
      <AuthLoginForm
        v-else-if="show"
        embedded
        @busy="busy = $event"
        @authenticated="navigateTo('/admin', { external: true })"
      >
        <template #heading-action>
          <VarButton
            class="account-inline-close"
            native-type="button"
            text
            round
            aria-label="关闭账户对话框"
            :disabled="busy"
            @click="close"
            ><CommonAppIcon name="close"
          /></VarButton>
        </template>
      </AuthLoginForm>
    </section>
  </VarPopup>
</template>
<style>
.account-dialog {
  position: relative;
  width: min(400px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  border-radius: 24px;
  color: var(--color-text);
}
.account-dialog .auth-card {
  width: 100%;
  border: 0;
  background: var(--color-surface-container-high);
}
.account-dialog .account-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  width: 44px;
  height: 44px;
}
.account-dialog .auth-heading {
  padding-right: 28px;
}
.account-dialog .auth-login-form .auth-heading {
  justify-content: space-between;
  padding-right: 0;
}
.account-dialog .account-inline-close {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
}
.account-dialog h2 {
  margin: 0;
  font-size: 22px;
}
.account-dialog .account-email {
  color: var(--color-text);
  overflow-wrap: anywhere;
}
.account-status p[role='status'] {
  color: var(--color-muted);
}
</style>
