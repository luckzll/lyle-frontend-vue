<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { login, register, trackProductEvent, trackPublicProductEvent } from '@/api/app'
import { toAppError } from '@/api/errors'
import { setAuth } from '@/auth'
import { resolveAuthRedirect } from '@/domain/auth-redirect'
import { useRuntimeFeatures } from '@/composables/useRuntimeFeatures'
import ambientFallbackUrl from '@/assets/auth/lyle-login-ambient.svg?url'

const PRODUCTION_AMBIENT_URL = 'https://common-prod-object.tos-cn-shanghai.volces.com/zl-dev/lyle/v6.3/login/background/lyle-v6.3-login-ambient-64f68e40@2x.webp'

const route = useRoute()
const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const runtimeFeatures = useRuntimeFeatures()
const demoEnabled = import.meta.env.DEV && import.meta.env.VITE_DEMO_CREDENTIALS_ENABLED === 'true'
const username = ref(demoEnabled ? (import.meta.env.VITE_DEMO_USERNAME || '') : '')
const password = ref(demoEnabled ? (import.meta.env.VITE_DEMO_PASSWORD || '') : '')
const passwordVisible = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const errorSummary = ref<HTMLElement | null>(null)
const usernameInput = ref<HTMLInputElement | null>(null)
const loginTab = ref<HTMLButtonElement | null>(null)
const registerTab = ref<HTMLButtonElement | null>(null)
const ambientSource = ref(import.meta.env.VITE_AUTH_LOGIN_BACKGROUND_URL || PRODUCTION_AMBIENT_URL)
const viewedAt = performance.now()

function useAmbientFallback() {
  if (ambientSource.value !== ambientFallbackUrl) ambientSource.value = ambientFallbackUrl
}

function switchMode(nextMode: 'login' | 'register', focusTarget: 'field' | 'tab' = 'field') {
  if (loading.value) return
  if (mode.value !== nextMode) {
    mode.value = nextMode
    password.value = ''
    passwordVisible.value = false
    errorMessage.value = ''
  }
  void nextTick(() => {
    if (focusTarget === 'tab') (nextMode === 'login' ? loginTab.value : registerTab.value)?.focus()
    else usernameInput.value?.focus()
  })
}

function tabKeydown(event: KeyboardEvent) {
  const nextMode = event.key === 'Home'
    ? 'login'
    : event.key === 'End'
      ? 'register'
      : event.key === 'ArrowLeft'
        ? (mode.value === 'login' ? 'register' : 'login')
        : event.key === 'ArrowRight'
          ? (mode.value === 'login' ? 'register' : 'login')
          : undefined
  if (!nextMode) return
  event.preventDefault()
  switchMode(nextMode, 'tab')
}

onMounted(() => {
  void trackPublicProductEvent({ eventType: 'auth_view_total', page: 'login', actionType: mode.value, status: 'succeeded' }).catch(() => undefined)
})

async function submit() {
  if (loading.value) return
  if (!username.value.trim() || !password.value) {
    errorMessage.value = '请输入用户名和密码。'
    void trackPublicProductEvent({
      eventType: 'auth_submit_total', page: 'login', actionType: mode.value, status: 'failed', errorCategory: 'validation',
      durationMs: Math.round(performance.now() - viewedAt)
    }).catch(() => undefined)
    await nextTick()
    ;(!username.value.trim() ? usernameInput.value : errorSummary.value)?.focus()
    return
  }

  if (mode.value === 'register' && (username.value.trim().length < 3 || username.value.trim().length > 64)) {
    errorMessage.value = '用户名需要 3～64 个字符。'
    await nextTick()
    errorSummary.value?.focus()
    return
  }

  if (mode.value === 'register' && (password.value.length < 8 || password.value.length > 128)) {
    errorMessage.value = '密码需要 8～128 个字符。'
    await nextTick()
    errorSummary.value?.focus()
    return
  }

  loading.value = true
  errorMessage.value = ''
  try {
    const request = mode.value === 'login' ? login : register
    const response = await request(username.value.trim(), password.value)
    setAuth(
      response.data.user,
      response.data.accessToken || response.data.token || '',
      response.data.expiresInSeconds
    )
    void trackProductEvent({
      eventType: 'auth_submit_total',
      page: 'login',
      actionType: mode.value,
      status: 'succeeded',
      durationMs: Math.round(performance.now() - viewedAt)
    }).catch(() => undefined)
    const redirect = resolveAuthRedirect(route.query.redirect)
    void trackProductEvent({
      eventType: 'auth_return_to_target_total', page: 'login', actionType: 'redirect', status: redirect.status,
      durationMs: Math.round(performance.now() - viewedAt)
    }).catch(() => undefined)
    await router.replace(redirect.target)
  } catch (error: unknown) {
    const hasResponse = Boolean((error as { response?: unknown })?.response)
    errorMessage.value = !hasResponse
      ? '暂时无法连接服务，请稍后重试。'
      : mode.value === 'register'
        ? toAppError(error, '注册失败，请检查输入。').message
        : '用户名或密码不正确，请重试。'
    password.value = ''
    void trackPublicProductEvent({
      eventType: 'auth_submit_total', page: 'login', actionType: mode.value, status: 'failed',
      errorCategory: hasResponse ? 'http' : 'network', durationMs: Math.round(performance.now() - viewedAt)
    }).catch(() => undefined)
    await nextTick()
    errorSummary.value?.focus()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page" :class="{ 'auth-page-v62': !runtimeFeatures.authLoginV63Enabled }">
    <div v-if="runtimeFeatures.authLoginV63Enabled" class="auth-ambient" aria-hidden="true">
      <img
        data-testid="auth-ambient-image"
        :src="ambientSource"
        alt=""
        width="1440"
        height="1024"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        @error="useAmbientFallback"
      />
    </div>

    <section class="auth-shell" aria-labelledby="auth-title">
      <header v-if="runtimeFeatures.authLoginV63Enabled" class="auth-brand">
        <span class="brand-mark" aria-hidden="true">L</span>
        <strong>Lyle AI</strong>
      </header>

      <header v-else class="legacy-heading">
        <h1>Lyle AI</h1>
        <p>登录后开始使用你的 AI 工作台</p>
      </header>

      <div class="auth-heading" :class="{ 'visually-hidden': !runtimeFeatures.authLoginV63Enabled }">
        <h1 id="auth-title">{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h1>
        <p>{{ mode === 'login' ? '继续推进你的工作' : '开始使用你的 AI 工作台' }}</p>
      </div>

      <div class="auth-tabs" role="tablist" aria-label="账号操作">
        <button
          ref="loginTab"
          id="login-tab"
          type="button"
          role="tab"
          data-testid="login-tab"
          :aria-selected="mode === 'login'"
          :tabindex="mode === 'login' ? 0 : -1"
          aria-controls="auth-panel"
          :disabled="loading"
          @click="switchMode('login')"
          @keydown="tabKeydown"
        >登录</button>
        <button
          ref="registerTab"
          id="register-tab"
          type="button"
          role="tab"
          data-testid="register-tab"
          :aria-selected="mode === 'register'"
          :tabindex="mode === 'register' ? 0 : -1"
          aria-controls="auth-panel"
          :disabled="loading"
          @click="switchMode('register')"
          @keydown="tabKeydown"
        >注册</button>
      </div>

      <form id="auth-panel" class="auth-form" role="tabpanel" :aria-labelledby="`${mode}-tab`" novalidate @submit.prevent="submit">
        <p
          v-if="errorMessage"
          ref="errorSummary"
          class="auth-error"
          role="alert"
          tabindex="-1"
        >{{ errorMessage }}</p>

        <label class="auth-field">
          <span>用户名</span>
          <input
            ref="usernameInput"
            v-model="username"
            autocomplete="username"
            data-testid="username-input"
            name="username"
            :aria-invalid="Boolean(errorMessage)"
            required
          />
        </label>

        <label class="auth-field">
          <span>密码</span>
          <span class="password-control">
            <input
              v-model="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              data-testid="password-input"
              name="password"
              :type="passwordVisible ? 'text' : 'password'"
              :minlength="mode === 'register' ? 8 : 6"
              maxlength="128"
              :aria-invalid="Boolean(errorMessage)"
              required
            />
            <button
              class="password-toggle"
              type="button"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              :aria-pressed="passwordVisible"
              @click="passwordVisible = !passwordVisible"
            >
              <EyeOff v-if="passwordVisible" :size="18" aria-hidden="true" />
              <Eye v-else :size="18" aria-hidden="true" />
            </button>
          </span>
        </label>

        <button class="auth-submit" data-testid="auth-submit" :disabled="loading" type="submit">
          {{ loading ? (mode === 'login' ? '登录中…' : '注册中…') : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>

      <p class="auth-switch">
        {{ mode === 'login' ? '没有账号？' : '已有账号？' }}
        <button type="button" :disabled="loading" @click="switchMode(mode === 'login' ? 'register' : 'login')">
          {{ mode === 'login' ? '注册' : '登录' }}
        </button>
      </p>
    </section>
  </main>
</template>

<style scoped>
.auth-page { position: relative; display: grid; min-height: 100svh; overflow: hidden; place-items: center; background: #fbfaf7; padding: 48px 20px; color: #171717; }
.auth-shell { position: relative; z-index: 1; display: grid; width: min(420px, 100%); gap: 28px; }
.auth-brand { display: flex; align-items: center; justify-content: center; gap: 11px; color: #27272a; font-size: clamp(27px, 4vw, 31px); letter-spacing: -.035em; }
.brand-mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 10px; background: #4f46e5; color: white; font-size: 20px; font-weight: 800; }
.auth-heading { text-align: center; }
.auth-heading h1 { margin: 0; font-size: clamp(22px, 3vw, 25px); letter-spacing: -.025em; }
.auth-heading p { margin: 9px 0 0; color: #71717a; }
.auth-tabs { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #e4e4e7; }
.auth-tabs button { min-height: 44px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: #71717a; padding: 0 12px; }
.auth-tabs button[aria-selected="true"] { border-color: #4f46e5; color: #27272a; font-weight: 700; }
.auth-form { display: grid; gap: 18px; }
.auth-field { display: grid; gap: 8px; color: #3f3f46; font-size: 14px; font-weight: 650; }
.auth-field input { width: 100%; height: 48px; border: 1px solid #d4d4d8; border-radius: 8px; outline: 0; background: rgba(255,255,255,.82); color: #18181b; padding: 0 13px; font: inherit; font-weight: 450; }
.auth-field input:focus-visible { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,.16); }
.password-control { position: relative; display: block; }
.password-control input { padding-right: 52px; }
.password-toggle { position: absolute; top: 2px; right: 2px; display: grid; width: 44px; height: 44px; place-items: center; border: 0; background: transparent; color: #71717a; padding: 0; }
.password-toggle:focus-visible { outline: 3px solid rgba(79,70,229,.24); outline-offset: -4px; }
.auth-submit { min-height: 48px; border-color: #4f46e5; background: #4f46e5; color: white; font-weight: 750; }
.auth-submit:hover:not(:disabled) { background: #4338ca; }
.auth-error { margin: 0; border: 1px solid #fecaca; border-radius: 8px; outline: 0; background: #fff7f7; color: #b91c1c; padding: 11px 12px; font-size: 13px; }
.auth-error:focus-visible { box-shadow: 0 0 0 3px rgba(220,38,38,.14); }
.auth-switch { margin: -8px 0 0; color: #71717a; text-align: center; font-size: 14px; }
.auth-switch button { min-height: 44px; border: 0; background: transparent; color: #4f46e5; padding: 0 4px; font-weight: 700; }
.auth-ambient { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.auth-ambient img { width: 100%; height: 100%; object-fit: cover; }
.legacy-heading { text-align: center; }.legacy-heading h1 { margin: 0; font-size: 34px; letter-spacing: -.04em; }.legacy-heading p { margin: 10px 0 0; color: #71717a; }.auth-page-v62 .auth-ambient { display: none; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 640px) { .auth-page { padding: 36px 20px; } .auth-shell { gap: 24px; } .auth-ambient { display: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
</style>
