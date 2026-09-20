<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Check, CheckCircle2, Clock3, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { http, publicHttp } from '@/api/http'
import type { AuthResponse } from '@/api/types'
import { setAuth } from '@/auth'
import { resolveAuthRedirect } from '@/domain/auth-redirect'
import { isValidEmail, maskEmail, normalizeEmail } from '@/domain/email'
import HumanVerification from './HumanVerification.vue'
import type { CaptchaOptions, CaptchaProof } from '@/domain/captcha'
import { useEmailCodeCooldown } from '@/composables/useEmailCodeCooldown'

const props = defineProps<{ binding?: boolean }>()
const email = ref(''), code = ref(''), boundEmail = ref(''), notice = ref(''), error = ref('')
const busy = ref(false), loading = ref(true), revealed = ref(false), enabled = ref(false)
const proof = ref<CaptchaProof | null>(null)
const sending = ref(false), codeRequested = ref(false)
const captcha = ref<CaptchaOptions | null>(null)
const mode = ref<'code' | 'password' | 'reset'>('code')
const password = ref(''), confirmPassword = ref(''), showPassword = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)
const emailInput = ref<HTMLInputElement | null>(null), codeInput = ref<HTMLInputElement | null>(null)
const router = useRouter(), route = useRoute()
const prefix = () => props.binding ? '/auth/email/binding' : mode.value === 'reset' ? '/auth/email/password' : '/auth/email'
const displayedEmail = computed(() => revealed.value ? boundEmail.value : maskEmail(boundEmail.value))
const usesCode = computed(() => props.binding || mode.value !== 'password')
const canSubmit = computed(() => usesCode.value ? enabled.value : Boolean(captcha.value?.configured && proof.value))
const cooldownScope = computed(() => usesCode.value ? { purpose: props.binding ? 'bind' : mode.value === 'reset' ? 'password-reset' : 'login', email: email.value } : null)
const { remainingSeconds: cooldown, start: startCooldown, applyRateLimit } = useEmailCodeCooldown(() => cooldownScope.value)
watch(email, () => { proof.value = null; code.value = ''; error.value = ''; notice.value = '' })
watch(cooldown, (seconds) => { if (seconds > 0) codeRequested.value = true }, { immediate: true })
function selectMode(next: 'code' | 'password' | 'reset') {
  if (busy.value) return
  mode.value = next
  password.value = ''; confirmPassword.value = ''; showPassword.value = false
  code.value = ''; proof.value = null; error.value = ''; notice.value = ''
}
function message(e: unknown) {
  const data = (e as { response?: { data?: { detail?: string; message?: string } } })?.response?.data
  return data?.detail || data?.message || '邮箱服务暂不可用，请稍后重试。'
}
async function load() {
  loading.value = true; error.value = ''
  try {
    // Load binding independently so a mail outage never hides an existing identity.
    if (props.binding) boundEmail.value = (await http.get<{ email: string }>('/auth/email/binding')).data.email
    if (!boundEmail.value) {
      const { data } = await publicHttp.get<{ enabled: boolean; captcha: CaptchaOptions }>('/auth/email/options')
      enabled.value = data.enabled; captcha.value = data.captcha
      if (!enabled.value && props.binding) error.value = '邮箱验证暂不可用，请稍后重试。'
    }
  } catch (e) { error.value = message(e) }
  finally { loading.value = false }
}
onMounted(load)
function validateEmail() {
  if (isValidEmail(email.value)) return true
  error.value = '邮箱格式不正确，例如 name@qq.com；请检查后缀、空格或多余标点。'
  emailInput.value?.focus(); return false
}
async function send() {
  if (busy.value || cooldown.value || !enabled.value) return
  if (!validateEmail()) return
  if (!proof.value) { error.value = '请先完成人机验证。'; return }
  const scope = cooldownScope.value
  if (!scope) return
  busy.value = true; sending.value = true; error.value = ''; notice.value = ''; code.value = ''
  try {
    const { data } = await http.post<{ retryAfterSeconds?: number }>(`${prefix()}/code`, { email: normalizeEmail(email.value), ...proof.value })
    notice.value = '验证码已发送，5 分钟内有效。未收到请检查垃圾邮件。'
    codeRequested.value = true
    startCooldown(data.retryAfterSeconds, scope)
  } catch (e) {
    error.value = message(e)
    applyRateLimit(e, scope)
  }
  finally { proof.value = null; sending.value = false; busy.value = false; await nextTick(); codeInput.value?.focus() }
}
async function submit() {
  if (busy.value || !validateEmail()) return
  if (!usesCode.value && !proof.value) { error.value = '请先完成安全验证，再使用密码登录。'; return }
  if (!canSubmit.value) return
  if (usesCode.value && !/^\d{6}$/.test(code.value)) { error.value = '请输入 6 位邮箱验证码。'; codeInput.value?.focus(); return }
  if (!props.binding && mode.value !== 'code') {
    if (!password.value) { error.value = '请输入密码。'; passwordInput.value?.focus(); return }
    if (mode.value === 'reset') {
      if (password.value.length < 8 || password.value.length > 64 || new TextEncoder().encode(password.value).length > 72) {
        error.value = '密码需要 8～64 个字符；较长的中文密码请适当缩短。'; passwordInput.value?.focus(); return
      }
      if (password.value !== confirmPassword.value) { error.value = '两次输入的密码不一致。'; return }
    }
  }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const body = { email: normalizeEmail(email.value), code: code.value }
    if (props.binding) {
      boundEmail.value = (await http.post<{ email: string }>(prefix(), body)).data.email
      notice.value = '绑定成功。后续可使用邮箱验证码登录此账号。'
    } else {
      const path = mode.value === 'password' ? '/auth/email/password/login' : mode.value === 'reset' ? '/auth/email/password/reset' : '/auth/email/login'
      const payload = mode.value === 'password' ? { email: body.email, password: password.value, ...proof.value }
        : mode.value === 'reset' ? { ...body, password: password.value } : body
      const { data } = await http.post<AuthResponse>(path, payload)
      setAuth(data.user, data.accessToken || data.token || '', data.expiresInSeconds)
      await router.replace(resolveAuthRedirect(route.query.redirect).target)
    }
  } catch (e) { error.value = message(e) }
  finally { if (!usesCode.value) proof.value = null; code.value = ''; password.value = ''; confirmPassword.value = ''; showPassword.value = false; busy.value = false }
}
</script>

<template>
  <section class="email-auth" :class="{ 'email-auth--binding': binding }" :aria-label="binding ? '登录邮箱' : '邮箱登录'" :aria-busy="loading || busy">
    <div v-if="!binding && mode !== 'reset'" class="login-methods" aria-label="登录方式">
      <button type="button" :class="{ active: mode === 'code' }" :aria-pressed="mode === 'code'" :disabled="busy" @click="selectMode('code')">验证码登录</button>
      <button type="button" :class="{ active: mode === 'password' }" :aria-pressed="mode === 'password'" :disabled="busy" @click="selectMode('password')">密码登录</button>
    </div>
    <div v-if="!binding && mode === 'reset'" class="password-reset-heading">
      <button class="password-link" type="button" :disabled="busy" @click="selectMode('password')"><ArrowLeft :size="15" aria-hidden="true" />返回密码登录</button>
      <h2>设置登录密码</h2>
      <p>验证已注册的邮箱，即可设置或重置密码。</p>
    </div>
    <div v-if="binding" class="binding-heading">
      <span class="binding-icon"><Mail :size="26" aria-hidden="true" /></span>
      <div><h3>登录邮箱</h3><p>你的安全登录方式</p></div>
      <span v-if="boundEmail" class="verified"><CheckCircle2 :size="14" aria-hidden="true" />已验证</span>
    </div>
    <p v-if="loading" class="email-muted" role="status">正在读取登录配置…</p>
    <div v-else-if="boundEmail" class="bound-details">
      <div class="bound-address"><strong>{{ displayedEmail }}</strong><button class="reveal-email" type="button" @click="revealed = !revealed">{{ revealed ? '隐藏' : '查看完整邮箱' }}</button></div>
      <p>用于接收登录验证码，你的数据保留在当前账号中。</p>
      <span class="bound-security"><ShieldCheck :size="16" aria-hidden="true" />支持验证码登录，也可在登录页设置邮箱密码</span>
    </div>
    <form v-else-if="enabled || !binding" novalidate @submit.prevent="submit">
      <p v-if="binding" class="email-muted">验证你常用的邮箱，为当前账号开启邮箱登录。</p>
      <div class="email-field">
        <label :for="binding ? 'binding-email' : 'login-email'">邮箱地址</label>
        <div class="input-shell"><Mail :size="20" aria-hidden="true" /><input :id="binding ? 'binding-email' : 'login-email'" ref="emailInput" v-model="email" type="email" autocomplete="email" autocapitalize="none" :spellcheck="false" maxlength="254" placeholder="请输入你的邮箱" :disabled="busy" /></div>
      </div>
      <p v-if="usesCode && !enabled" class="email-muted" role="status">邮箱验证暂不可用，{{ binding ? '请稍后重试。' : '已有密码可切换密码登录。' }}<button class="retry-config" type="button" :disabled="busy" @click="load">重新加载</button></p>
      <p v-if="!usesCode && !captcha?.configured" class="email-muted" role="status">安全验证暂不可用，请稍后重试。<button class="retry-config" type="button" :disabled="busy" @click="load">重新加载</button></p>
      <HumanVerification v-if="usesCode && enabled" :key="`${mode}:${email}`" v-model="proof" :options="captcha" :disabled="busy || cooldown > 0" :cooldown-seconds="cooldown" />
      <div v-if="usesCode" class="email-field">
        <label :for="binding ? 'binding-code' : 'login-code'">邮箱验证码</label>
        <div class="input-shell"><KeyRound :size="20" aria-hidden="true" /><input :id="binding ? 'binding-code' : 'login-code'" ref="codeInput" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="请输入 6 位验证码" :disabled="busy || !enabled" :aria-describedby="cooldown ? 'email-resend-countdown' : undefined" /><button class="send-code" :class="{ 'is-cooling-down': cooldown > 0 }" type="button" :disabled="busy || cooldown > 0 || !enabled" @click="send">{{ sending ? '发送中…' : cooldown ? `${cooldown} 秒后重发` : codeRequested ? '重新发送' : '获取验证码' }}</button></div>
        <p v-if="cooldown > 0" id="email-resend-countdown" class="resend-countdown" role="timer" aria-live="off"><Clock3 :size="14" aria-hidden="true" /><span>{{ cooldown }} 秒后可重新发送，请先查收邮箱。</span></p>
      </div>
      <template v-if="!binding && mode !== 'code'">
        <div class="email-field">
          <div class="password-label"><label for="login-password">{{ mode === 'reset' ? '新密码' : '密码' }}</label><button v-if="mode === 'password'" class="password-link" type="button" :disabled="busy" @click="selectMode('reset')">设置 / 忘记密码</button></div>
          <div class="input-shell"><LockKeyhole :size="20" aria-hidden="true" /><input id="login-password" ref="passwordInput" v-model="password" :type="showPassword ? 'text' : 'password'" :autocomplete="mode === 'reset' ? 'new-password' : 'current-password'" :maxlength="mode === 'reset' ? 64 : 128" :placeholder="mode === 'reset' ? '设置 8–64 位密码' : '请输入你的密码'" :disabled="busy" /><button class="password-reveal" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="19" aria-hidden="true" /><Eye v-else :size="19" aria-hidden="true" /></button></div>
        </div>
        <div v-if="mode === 'reset'" class="email-field">
          <label for="confirm-password">确认新密码</label>
          <div class="input-shell"><LockKeyhole :size="20" aria-hidden="true" /><input id="confirm-password" v-model="confirmPassword" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" maxlength="64" placeholder="再次输入新密码" :disabled="busy" /></div>
        </div>
      </template>
      <HumanVerification v-if="!usesCode" :key="`password:${email}`" v-model="proof" :options="captcha" :disabled="busy" />
      <button class="email-submit" type="submit" :disabled="busy || !canSubmit">{{ busy ? '处理中…' : binding ? '验证并绑定' : mode === 'password' ? '登录' : mode === 'reset' ? '设置密码并登录' : '登录 / 注册' }}</button>
      <p v-if="!binding" class="email-footnote">{{ mode === 'code' ? '首次验证邮箱将自动创建账号' : mode === 'password' ? '还没有账号？使用验证码登录即可注册' : '设置成功后，其他设备需要重新登录' }}</p>
    </form>
    <p v-if="error" class="email-error" role="alert">{{ error }}</p>
    <button v-if="binding && !loading && !enabled && !boundEmail" class="retry-config" type="button" @click="load">重新加载</button>
    <p v-if="notice" class="email-notice" role="status"><Check :size="16" aria-hidden="true" />{{ notice }}</p>
  </section>
</template>

<style scoped>
.email-auth { color: #0f172a; }
.email-auth form { display: grid; gap: 26px; }
.login-methods { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f1f5f9; }
.login-methods button { min-height: 42px; border: 0; border-radius: 8px; background: transparent; color: #475569; font-size: 15px; font-weight: 600; box-shadow: none; }
.login-methods button.active { background: #fff; color: #4f46e5; box-shadow: 0 1px 3px #0f172a12; }
.password-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.password-link { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 4px; padding: 0; color: #4f46e5; background: transparent; font-size: 13px; line-height: 1.6; box-shadow: none; }
.password-reveal { display: grid; place-items: center; flex-shrink: 0; width: 32px; height: 36px; border: 0; background: transparent; color: #64748b; padding: 0; box-shadow: none; }
.password-reset-heading { margin-bottom: 22px; }
.password-reset-heading h2 { margin: 14px 0 6px; font-size: 20px; }
.password-reset-heading p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.65; }
.email-field { display: grid; gap: 10px; min-width: 0; }
.email-field label { font-size: 15px; font-weight: 600; }
.input-shell { display: flex; align-items: center; gap: 16px; min-height: 58px; border: 1px solid #cbd5e1; border-radius: 12px; padding: 0 20px; background: #fff; color: #64748b; transition: border-color .15s; }
.input-shell:focus-within { border-color: #4f46e5; outline: 3px solid #eef2ff; }
.input-shell > svg { flex-shrink: 0; }
.input-shell input { min-width: 0; width: 100%; flex: 1; border: 0; outline: 0; box-shadow: none; border-radius: 0; padding: 16px 0; background: transparent; color: #0f172a; font: inherit; font-size: 16px; }
.input-shell input::placeholder { color: #76849a; }
.send-code { flex-shrink: 0; padding: 6px 0 6px 18px; border: 0; border-left: 1px solid #e2e8f0; border-radius: 0; background: transparent; color: #4f46e5; font-size: 15px; font-weight: 600; box-shadow: none; }
.send-code.is-cooling-down:disabled { color: #64748b; opacity: 1; font-variant-numeric: tabular-nums; }
.resend-countdown { display: flex; align-items: center; gap: 6px; margin: 0; color: #64748b; font-size: 12px; line-height: 1.6; font-variant-numeric: tabular-nums; }
.resend-countdown svg { flex-shrink: 0; }
.email-submit { min-height: 58px; border: 1px solid #4f46e5; border-radius: 12px; background: #4f46e5; color: #fff; font-size: 18px; font-weight: 600; box-shadow: none; }
.email-submit:hover:not(:disabled) { background: #4338ca; }
.email-auth button:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 3px; }
.email-auth button:disabled { opacity: .55; cursor: not-allowed; }
.email-footnote,.email-muted { margin: 0; color: #64748b; font-size: 13px; line-height: 1.65; }
.email-footnote { text-align: center; margin-top: -12px; }
.email-error { color: #b91c1c; background: #fff1f2; padding: 12px 14px; border-radius: 8px; font-size: 14px; line-height: 1.6; margin: 18px 0 0; }
.email-notice { display: flex; align-items: flex-start; gap: 8px; color: #047857; font-size: 14px; line-height: 1.6; margin: 18px 0 0; }
.email-notice svg { flex-shrink: 0; margin-top: 3px; }
.retry-config,.reveal-email { background: transparent; color: #4f46e5; border: 0; padding: 8px 0; font-size: 13px; }
.binding-heading { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; }
.binding-icon { display: grid; place-items: center; width: 56px; height: 56px; flex-shrink: 0; border-radius: 14px; color: #4f46e5; background: #eef2ff; }
.binding-heading h3 { margin: 0; font-size: 18px; font-weight: 650; }
.binding-heading p,.bound-details p { margin: 5px 0 0; color: #64748b; font-size: 14px; line-height: 1.7; }
.verified { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; border-radius: 99px; padding: 5px 10px; background: #ecfdf5; color: #047857; font-size: 12px; white-space: nowrap; }
.bound-details { margin-left: 72px; }
.bound-address { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.bound-address strong { font-size: 17px; overflow-wrap: anywhere; }
.bound-security { display: inline-flex; align-items: center; gap: 7px; margin-top: 18px; color: #64748b; font-size: 12px; }
.email-auth--binding form { max-width: 560px; }
@media(max-width: 520px) { .input-shell { gap: 10px; padding: 0 12px; } .send-code { font-size: 13px; padding-left: 10px; } .input-shell input { font-size: 15px; } .bound-details { margin-left: 0; } .binding-heading { gap: 12px; } }
</style>
