<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Check, CheckCircle2, KeyRound, Mail, ShieldCheck } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { http, publicHttp } from '@/api/http'
import type { AuthResponse } from '@/api/types'
import { setAuth } from '@/auth'
import { resolveAuthRedirect } from '@/domain/auth-redirect'
import { isValidEmail, maskEmail, normalizeEmail } from '@/domain/email'
import HumanVerification from './HumanVerification.vue'
import type { CaptchaOptions, CaptchaProof } from '@/domain/captcha'

const props = defineProps<{ binding?: boolean; wechatLink?: boolean; legacyLink?: boolean }>()
const email = ref(''), code = ref(''), boundEmail = ref(''), notice = ref(''), error = ref('')
const busy = ref(false), loading = ref(true), revealed = ref(false), enabled = ref(false)
const cooldown = ref(0), proof = ref<CaptchaProof | null>(null)
const captcha = ref<CaptchaOptions | null>(null)
const emailInput = ref<HTMLInputElement | null>(null), codeInput = ref<HTMLInputElement | null>(null)
const router = useRouter(), route = useRoute()
let timer: ReturnType<typeof setInterval> | undefined
let expiresAt = 0
const prefix = () => props.binding ? '/auth/email/binding' : props.wechatLink ? '/auth/wechat/email' : props.legacyLink ? '/auth/migration/email' : '/auth/email'
const displayedEmail = computed(() => revealed.value ? boundEmail.value : maskEmail(boundEmail.value))
watch(email, () => { proof.value = null; code.value = ''; error.value = ''; notice.value = '' })
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
      if (!enabled.value) error.value = '邮箱登录暂不可用，请稍后重试。'
    }
  } catch (e) { error.value = message(e) }
  finally { loading.value = false }
}
onMounted(load)
onUnmounted(() => { if (timer) clearInterval(timer) })
function validateEmail() {
  if (isValidEmail(email.value)) return true
  error.value = '邮箱格式不正确，例如 name@qq.com；请检查后缀、空格或多余标点。'
  emailInput.value?.focus(); return false
}
async function send() {
  if (busy.value || cooldown.value || !enabled.value) return
  if (!validateEmail()) return
  if (!proof.value) { error.value = '请先完成人机验证。'; return }
  busy.value = true; error.value = ''; notice.value = ''; code.value = ''
  try {
    const { data } = await http.post<{ retryAfterSeconds?: number }>(`${prefix()}/code`, { email: normalizeEmail(email.value), ...proof.value })
    notice.value = '验证码已发送，5 分钟内有效。未收到请检查垃圾邮件。'
    expiresAt = Date.now() + Math.max(60, data.retryAfterSeconds || 60) * 1000
    cooldown.value = Math.ceil((expiresAt - Date.now()) / 1000)
    if (timer) clearInterval(timer)
    timer = setInterval(() => { cooldown.value = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)); if (!cooldown.value && timer) clearInterval(timer) }, 1000)
  } catch (e) { error.value = message(e) }
  finally { proof.value = null; busy.value = false; await nextTick(); codeInput.value?.focus() }
}
async function submit() {
  if (busy.value || !enabled.value || !validateEmail()) return
  if (!/^\d{6}$/.test(code.value)) { error.value = '请输入 6 位邮箱验证码。'; codeInput.value?.focus(); return }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const body = { email: normalizeEmail(email.value), code: code.value }
    if (props.binding) {
      boundEmail.value = (await http.post<{ email: string }>(prefix(), body)).data.email
      notice.value = '绑定成功。后续可使用邮箱验证码登录此账号。'
    } else {
      const { data } = await http.post<AuthResponse>(`${prefix()}/login`, body)
      setAuth(data.user, data.accessToken || data.token || '', data.expiresInSeconds)
      let target: unknown = route.query.redirect
      if (props.wechatLink) {
        try { target = sessionStorage.getItem('lyle-wechat-return') || target; sessionStorage.removeItem('lyle-wechat-return') } catch { /* optional redirect preference */ }
      }
      await router.replace(resolveAuthRedirect(target).target)
    }
  } catch (e) { error.value = message(e) }
  finally { code.value = ''; busy.value = false }
}
</script>

<template>
  <section class="email-auth" :class="{ 'email-auth--binding': binding }" :aria-label="binding ? '登录邮箱' : '邮箱验证码登录'" :aria-busy="loading || busy">
    <div v-if="binding" class="binding-heading">
      <span class="binding-icon"><Mail :size="26" aria-hidden="true" /></span>
      <div><h3>登录邮箱</h3><p>你的安全登录方式</p></div>
      <span v-if="boundEmail" class="verified"><CheckCircle2 :size="14" aria-hidden="true" />已验证</span>
    </div>
    <p v-if="loading" class="email-muted" role="status">正在读取登录配置…</p>
    <div v-else-if="boundEmail" class="bound-details">
      <div class="bound-address"><strong>{{ displayedEmail }}</strong><button class="reveal-email" type="button" @click="revealed = !revealed">{{ revealed ? '隐藏' : '查看完整邮箱' }}</button></div>
      <p>用于接收登录验证码，你的数据保留在当前账号中。</p>
      <span class="bound-security"><ShieldCheck :size="16" aria-hidden="true" />无需记住密码，验证邮箱即可登录</span>
    </div>
    <form v-else-if="enabled" novalidate @submit.prevent="submit">
      <p v-if="binding" class="email-muted">验证你常用的邮箱，为当前账号开启邮箱登录。</p>
      <div class="email-field">
        <label :for="binding ? 'binding-email' : 'login-email'">邮箱地址</label>
        <div class="input-shell"><Mail :size="20" aria-hidden="true" /><input :id="binding ? 'binding-email' : 'login-email'" ref="emailInput" v-model="email" type="email" autocomplete="email" autocapitalize="none" :spellcheck="false" maxlength="254" placeholder="请输入你的邮箱" :disabled="busy" /></div>
      </div>
      <HumanVerification :key="email" v-model="proof" :options="captcha" :disabled="busy || cooldown > 0" />
      <div class="email-field">
        <label :for="binding ? 'binding-code' : 'login-code'">邮箱验证码</label>
        <div class="input-shell"><KeyRound :size="20" aria-hidden="true" /><input :id="binding ? 'binding-code' : 'login-code'" ref="codeInput" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="请输入 6 位验证码" :disabled="busy" /><button class="send-code" type="button" :disabled="busy || cooldown > 0" @click="send">{{ cooldown ? `${cooldown} 秒后重发` : '获取验证码' }}</button></div>
      </div>
      <button class="email-submit" type="submit" :disabled="busy">{{ busy ? '处理中…' : binding ? '验证并绑定' : wechatLink ? '关联微信并登录' : legacyLink ? '绑定邮箱并进入原账号' : '登录 / 注册' }}</button>
      <p v-if="!binding" class="email-footnote">{{ legacyLink ? '只绑定原账号，不创建新账号，原有数据保留' : wechatLink ? '验证邮箱后关联微信；新邮箱将创建账号' : '首次验证邮箱将自动创建账号' }}</p>
    </form>
    <p v-if="error" class="email-error" role="alert">{{ error }}</p>
    <button v-if="!loading && !enabled && !boundEmail" class="retry-config" type="button" @click="load">重新加载</button>
    <p v-if="notice" class="email-notice" role="status"><Check :size="16" aria-hidden="true" />{{ notice }}</p>
  </section>
</template>

<style scoped>
.email-auth { color: #0f172a; }
.email-auth form { display: grid; gap: 26px; }
.email-field { display: grid; gap: 10px; min-width: 0; }
.email-field label { font-size: 15px; font-weight: 600; }
.input-shell { display: flex; align-items: center; gap: 16px; min-height: 58px; border: 1px solid #cbd5e1; border-radius: 12px; padding: 0 20px; background: #fff; color: #64748b; transition: border-color .15s; }
.input-shell:focus-within { border-color: #4f46e5; outline: 3px solid #eef2ff; }
.input-shell > svg { flex-shrink: 0; }
.input-shell input { min-width: 0; width: 100%; flex: 1; border: 0; outline: 0; box-shadow: none; border-radius: 0; padding: 16px 0; background: transparent; color: #0f172a; font: inherit; font-size: 16px; }
.input-shell input::placeholder { color: #76849a; }
.send-code { flex-shrink: 0; padding: 6px 0 6px 18px; border: 0; border-left: 1px solid #e2e8f0; border-radius: 0; background: transparent; color: #4f46e5; font-size: 15px; font-weight: 600; box-shadow: none; }
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
