<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import wechatIcon from '@iconify-icons/simple-icons/wechat'
import { RefreshCw, ShieldCheck } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { publicHttp } from '@/api/http'
import type { AuthResponse } from '@/api/types'
import { setAuth } from '@/auth'
import { resolveAuthRedirect } from '@/domain/auth-redirect'
import { isWechatQrUrl } from '@/domain/wechat-login'
import EmailAuthForm from './EmailAuthForm.vue'

const emit = defineEmits<{ email: [] }>()
const props = defineProps<{ legacy?: boolean }>()
const route = useRoute(), router = useRouter()
const loading = ref(true), enabled = ref(false), error = ref(''), qrUrl = ref(''), seconds = ref(0), requiresEmail = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let alive = true, deadline = 0
const redirectKey = 'lyle-wechat-return'
function message(e: unknown) {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '微信登录暂不可用，请重试或使用邮箱登录。'
}
async function start() {
  loading.value = true; error.value = ''; qrUrl.value = ''; requiresEmail.value = false
  if (timer) clearInterval(timer)
  try {
    const { data } = await publicHttp.post('/auth/wechat/start', { legacy: Boolean(props.legacy) }, { timeout: 15000 })
    if (!alive) return
    if (!isWechatQrUrl(data.qrUrl)) throw new Error('Invalid provider URL')
    try { sessionStorage.setItem(redirectKey, resolveAuthRedirect(route.query.redirect).target) } catch { /* optional navigation preference */ }
    qrUrl.value = data.qrUrl
    deadline = Date.now() + Math.min(300, Math.max(1, Number(data.expiresInSeconds) || 300)) * 1000
    seconds.value = Math.ceil((deadline - Date.now()) / 1000)
    timer = setInterval(() => {
      seconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (!seconds.value) { qrUrl.value = ''; if (timer) clearInterval(timer) }
    }, 1000)
  } catch (e) { if (alive) error.value = message(e) }
  finally { if (alive) loading.value = false }
}
async function load() {
  loading.value = true; error.value = ''
  try {
    enabled.value = (await publicHttp.get<{ enabled: boolean }>('/auth/wechat/options')).data.enabled
    if (!alive || !enabled.value) return
    if (route.query.wechat === 'failed') { error.value = '授权未完成或二维码已过期，请重新扫码。'; return }
    if (route.query.wechat === 'complete') {
      const { data } = await publicHttp.post<AuthResponse & { requiresEmail?: boolean }>('/auth/wechat/complete', {}, { timeout: 15000 })
      if (!alive) return
      if (data.requiresEmail) { requiresEmail.value = true; return }
      setAuth(data.user, data.accessToken || data.token || '', data.expiresInSeconds)
      let target: unknown = route.query.redirect
      try { target = sessionStorage.getItem(redirectKey) || target; sessionStorage.removeItem(redirectKey) } catch { /* optional */ }
      await router.replace(resolveAuthRedirect(target).target)
    } else await start()
  } catch (e) { if (alive) error.value = message(e) }
  finally { if (alive) loading.value = false }
}
onMounted(load)
onUnmounted(() => { alive = false; if (timer) clearInterval(timer) })
</script>

<template>
  <section class="wechat-auth" aria-label="微信扫码登录" :aria-busy="loading">
    <p v-if="loading" class="wechat-status" role="status">正在连接微信…</p>
    <template v-else-if="requiresEmail">
      <div class="wechat-linked"><ShieldCheck :size="20" /><div><strong>微信已验证，再确认一下邮箱</strong><p>已有账号请使用原来绑定的邮箱，历史数据会保留。以后可直接扫码登录。</p></div></div>
      <EmailAuthForm wechat-link />
      <button type="button" class="wechat-text-button" @click="start">换一个微信，重新扫码</button>
    </template>
    <template v-else-if="!enabled && !error">
      <div class="wechat-empty"><Icon :icon="wechatIcon" width="44" aria-hidden="true" /><h2>微信登录即将开放</h2><p>暂时先用邮箱登录，<br />后续关联微信即可继续使用同一个账号。</p><button class="wechat-primary" type="button" @click="emit('email')">使用邮箱登录</button></div>
    </template>
    <template v-else>
      <iframe v-if="qrUrl" :src="qrUrl" title="微信官方登录二维码" class="wechat-frame" referrerpolicy="no-referrer" />
      <p v-else-if="!error" class="wechat-status" role="status">二维码已过期，请刷新后重新扫码。</p>
      <p v-if="error" class="wechat-error" role="alert">{{ error }}</p>
      <div class="wechat-actions"><span v-if="qrUrl">用微信扫一扫，在手机上确认</span><button type="button" :disabled="loading" @click="enabled ? start() : load()"><RefreshCw :size="15" />{{ qrUrl ? '刷新二维码' : '重新加载' }}</button></div>
      <p class="wechat-note">{{ legacy ? '扫码确认后将微信绑定到已验证的原账号，原数据保留。' : '首次使用需验证邮箱，让两种登录方式共用一个账号。' }}</p>
      <button class="wechat-text-button" type="button" @click="emit('email')">不方便扫码？使用邮箱登录</button>
    </template>
  </section>
</template>

<style scoped>
.wechat-auth { min-height: 360px; color: #0f172a; }
.wechat-empty { min-height: 350px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.wechat-empty > svg { color: #168b48; margin-bottom: 18px; }
.wechat-empty h2 { margin: 0; font-size: 21px; font-weight: 650; }
.wechat-empty p, .wechat-note { color: #64748b; font-size: 14px; line-height: 1.8; }
.wechat-primary { background: #4f46e5; color: #fff; border: 0; border-radius: 10px; padding: 12px 26px; margin-top: 10px; font-weight: 600; }
.wechat-frame { display: block; width: 300px; max-width: 100%; height: 400px; border: 0; margin: 0 auto; }
.wechat-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; color: #64748b; font-size: 13px; }
.wechat-actions button, .wechat-text-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: transparent; color: #4f46e5; font-size: 13px; padding: 8px; }
.wechat-note { text-align: center; margin: 8px 0 0; font-size: 12px; }
.wechat-text-button { display: flex; margin: 8px auto 0; }
.wechat-status { padding: 90px 16px; text-align: center; color: #64748b; }
.wechat-error { padding: 16px; background: #fff1f2; border-radius: 10px; color: #b91c1c; font-size: 14px; line-height: 1.7; }
.wechat-linked { display: flex; gap: 10px; margin-bottom: 16px; color: #047857; }
.wechat-linked svg { flex-shrink: 0; margin-top: 3px; }
.wechat-linked strong { font-size: 15px; }
.wechat-linked p { margin: 5px 0 0; color: #64748b; font-size: 13px; line-height: 1.7; }
button:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 3px; }
</style>
