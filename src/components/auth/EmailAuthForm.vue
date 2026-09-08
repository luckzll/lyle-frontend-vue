<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { http } from '@/api/http'
import type { AuthResponse } from '@/api/types'
import { setAuth } from '@/auth'
import { resolveAuthRedirect } from '@/domain/auth-redirect'

const props = defineProps<{ binding?: boolean }>()
const email = ref('')
const code = ref('')
const boundEmail = ref('')
const notice = ref('')
const error = ref('')
const busy = ref(false)
const cooldown = ref(0)
const router = useRouter()
const route = useRoute()
let timer: ReturnType<typeof setInterval> | undefined
const prefix = () => props.binding ? '/auth/email/binding' : '/auth/email'
function message(e: unknown) {
  const data = (e as { response?: { data?: { detail?: string; message?: string } } })?.response?.data
  return data?.detail || data?.message || '邮箱服务暂不可用，请稍后重试。'
}
onMounted(async () => {
  if (props.binding) {
    try { boundEmail.value = (await http.get<{ email: string }>('/auth/email/binding')).data.email }
    catch (e) { error.value = message(e) }
  }
})
onUnmounted(() => { if (timer) clearInterval(timer) })
async function send() {
  if (busy.value || cooldown.value) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { error.value = '请输入有效邮箱地址。'; return }
  busy.value = true; error.value = ''; notice.value = ''; code.value = ''
  try {
    await http.post(`${prefix()}/code`, { email: email.value.trim() })
    notice.value = '验证码已发送，5分钟内有效；请同时检查垃圾邮件。'
    cooldown.value = 60
    if (timer) clearInterval(timer)
    timer = setInterval(() => { if (--cooldown.value <= 0 && timer) clearInterval(timer) }, 1000)
  } catch (e) { error.value = message(e) }
  finally { busy.value = false }
}
async function submit() {
  if (busy.value) return
  if (!/^\d{6}$/.test(code.value)) { error.value = '请输入6位验证码。'; return }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const body = { email: email.value.trim(), code: code.value }
    if (props.binding) {
      boundEmail.value = (await http.post<{ email: string }>(prefix(), body)).data.email
      notice.value = '邮箱已绑定，后续可使用邮箱验证码登录此账号。'
    } else {
      const { data } = await http.post<AuthResponse>('/auth/email/login', body)
      setAuth(data.user, data.accessToken || data.token || '', data.expiresInSeconds)
      await router.replace(resolveAuthRedirect(route.query.redirect).target)
    }
  } catch (e) { error.value = message(e) }
  finally { code.value = ''; busy.value = false }
}
</script>

<template>
  <section class="email-auth" :aria-label="binding ? '绑定邮箱' : '邮箱验证码登录'">
    <h3 v-if="binding">绑定邮箱</h3>
    <p v-if="boundEmail">已绑定：{{ boundEmail }}</p>
    <form v-else @submit.prevent="submit">
      <p>{{ binding ? '绑定后可使用邮箱登录，保留当前账号全部数据。' : '首次验证将自动创建账号。已有用户名账号请先用密码登录，再到设置绑定邮箱。' }}</p>
      <label>邮箱<input v-model="email" type="email" autocomplete="email" maxlength="254" required :disabled="busy" /></label>
      <label>验证码<input v-model="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required :disabled="busy" /></label>
      <button type="button" :disabled="busy || cooldown > 0" @click="send">{{ cooldown ? `${cooldown}秒后重发` : '发送验证码' }}</button>
      <button type="submit" :disabled="busy">{{ busy ? '处理中…' : binding ? '验证并绑定' : '验证并登录' }}</button>
    </form>
    <p v-if="error" class="email-error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.email-auth { display: grid; gap: 12px; }
form { display: grid; gap: 14px; }
label { display: grid; gap: 8px; font-size: 14px; }
input { width: 100%; min-height: 46px; border: 1px solid #d4d4d8; border-radius: 8px; padding: 10px 12px; background: white; color: #18181b; }
button { min-height: 44px; }
button[type=submit] { background: #4f46e5; color: white; }
p { font-size: 13px; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
.email-error { color: #b91c1c; }
</style>
