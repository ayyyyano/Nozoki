<script setup lang="ts">
import type { SessionDto } from '../../../shared/contracts/auth'
const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{
  authenticated: [session: Extract<SessionDto, { viewer: 'admin' }>]
  busy: [value: boolean]
}>()
let request: AbortController | null = null
let disposed = false
const email = ref(''),
  password = ref(''),
  show = ref(false),
  busy = ref(false),
  message = ref('')
async function submit() {
  if (busy.value) return
  busy.value = true
  emit('busy', true)
  request = new AbortController()
  message.value = ''
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
      signal: request.signal,
      timeout: 15000,
    })
    password.value = ''
    const session = await $fetch<SessionDto>('/api/auth/session', {
      signal: request.signal,
      timeout: 15000,
    })
    if (session.viewer !== 'admin') {
      message.value = '浏览器未保存登录 Cookie，请启用后重试'
      return
    }
    if (!disposed) emit('authenticated', session)
  } catch (error: unknown) {
    if (disposed) return
    const code = (error as { data?: { code?: string } }).data?.code
    message.value =
      code === 'INVALID_CREDENTIALS'
        ? '邮箱或密码错误'
        : code === 'LOGIN_LIMITED'
          ? '登录暂时受限，请稍后重试'
          : '暂时无法登录'
  } finally {
    password.value = ''
    show.value = false
    busy.value = false
    request = null
    emit('busy', false)
  }
}
onBeforeUnmount(() => {
  disposed = true
  request?.abort()
  password.value = ''
})
</script>
<template>
  <form
    class="auth-card auth-login-form"
    method="post"
    action="/api/auth/login"
    @submit.prevent="submit"
  >
    <header class="auth-heading">
      <component :is="props.embedded ? 'h2' : 'h1'">管理员登录</component>
      <slot name="heading-action" />
    </header>
    <VarInput
      v-model="email"
      placeholder="邮箱"
      aria-label="邮箱"
      type="email"
      autocomplete="username"
      :maxlength="254"
      variant="outlined"
      class="auth-input"
      :disabled="busy"
      ><template #prepend-icon
        ><CommonAppIcon name="mail" class="auth-field-icon" :size="22" /></template
    ></VarInput>
    <div class="password-field">
      <VarInput
        v-model="password"
        placeholder="密码"
        aria-label="密码"
        :type="show ? 'text' : 'password'"
        :prevent-auto-fill="false"
        autocomplete="current-password"
        :maxlength="1024"
        variant="outlined"
        class="auth-input"
        :disabled="busy"
        ><template #prepend-icon
          ><CommonAppIcon name="lock" class="auth-field-icon" :size="22" /></template
        ><template #append-icon>
          <VarButton
            native-type="button"
            text
            round
            :aria-label="show ? '隐藏密码' : '显示密码'"
            :aria-pressed="show"
            @click="show = !show"
            ><CommonAppIcon :name="show ? 'eyeOff' : 'eye'"
          /></VarButton> </template
      ></VarInput>
    </div>
    <p v-if="message" role="alert">{{ message }}</p>
    <VarButton native-type="submit" type="primary" block :loading="busy" :disabled="busy"
      ><span class="auth-submit-content"
        ><CommonAppIcon name="arrow" :size="20" /><span>登录</span></span
      ></VarButton
    >
    <NuxtLink v-if="!props.embedded" to="/"
      ><CommonAppIcon name="home" :size="20" />返回看板</NuxtLink
    >
  </form>
</template>
<style src="../../assets/styles/management.css"></style>
