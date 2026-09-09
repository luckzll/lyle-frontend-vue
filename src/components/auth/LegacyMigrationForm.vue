<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { publicHttp } from '@/api/http'
import HumanVerification from './HumanVerification.vue'
import EmailAuthForm from './EmailAuthForm.vue'
import WechatAuthForm from './WechatAuthForm.vue'
import type { CaptchaOptions, CaptchaProof } from '@/domain/captcha'

const username = ref(''), password = ref(''), error = ref(''), busy = ref(false), verified = ref(false)
const method = ref<'email' | 'wechat'>('email')
const captcha = ref<CaptchaOptions | null>(null), proof = ref<CaptchaProof | null>(null)
onMounted(async () => {
  try { captcha.value = (await publicHttp.get('/auth/email/options')).data.captcha }
  catch { error.value = '暂时无法加载安全验证，请返回登录后重试。' }
})
async function verify() {
  if (busy.value) return
  if (!username.value || !password.value) { error.value = '请输入原来的用户名和密码。'; return }
  if (!proof.value) { error.value = '请先完成人机验证。'; return }
  busy.value = true; error.value = ''
  try {
    await publicHttp.post('/auth/migration/start', {username:username.value,password:password.value,...proof.value},{timeout:15000})
    verified.value = true
  } catch (e) { error.value = (e as {response?:{data?:{detail?:string}}})?.response?.data?.detail || '原账号验证失败，请重试。' }
  finally { password.value = ''; proof.value = null; busy.value = false }
}
async function switchBinding(next: 'email'|'wechat') {
  if (next === 'email') { try { await publicHttp.post('/auth/wechat/cancel', {}) } catch { /* bounded expiry */ } }
  method.value = next
}
</script>
<template>
  <section class="legacy-migration" aria-label="旧账号绑定">
    <p class="legacy-explanation">{{ verified ? '原账号已验证。绑定一种登录方式，即可继续使用原来的数据。' : '仅供尚未绑定邮箱或微信的旧账号使用。先验证原账号，再绑定登录方式。' }}</p>
    <form v-if="!verified" @submit.prevent="verify">
      <label for="legacy-username">原用户名</label><input id="legacy-username" v-model="username" autocomplete="username" maxlength="64" :disabled="busy" />
      <label for="legacy-password">原密码</label><input id="legacy-password" v-model="password" type="password" autocomplete="current-password" maxlength="128" :disabled="busy" />
      <HumanVerification v-model="proof" :options="captcha" :disabled="busy" />
      <button class="legacy-primary" :disabled="busy || !captcha" type="submit">{{ busy ? '正在验证…' : '验证原账号，继续绑定' }}</button>
    </form>
    <template v-else>
      <div class="legacy-methods" aria-label="选择绑定方式"><button type="button" :aria-pressed="method === 'email'" @click="switchBinding('email')">绑定邮箱</button><button type="button" :aria-pressed="method === 'wechat'" @click="switchBinding('wechat')">绑定微信</button></div>
      <EmailAuthForm v-if="method === 'email'" legacy-link />
      <WechatAuthForm v-else legacy @email="switchBinding('email')" />
    </template>
    <p v-if="error" role="alert" class="legacy-error">{{ error }}</p>
  </section>
</template>
<style scoped>
.legacy-explanation { margin: 0 0 20px; color: #64748b; font-size: 14px; line-height: 1.8; }
form { display: grid; gap: 12px; }
label { font-size: 15px; font-weight: 600; }
input { width: 100%; box-sizing: border-box; min-height: 48px; padding: 12px 16px; border: 1px solid #cbd5e1; border-radius: 12px; color: #0f172a; background: #fff; font-size: 16px; }
.legacy-primary { min-height: 48px; border: 0; border-radius: 12px; color: #fff; background: #4f46e5; font-weight: 600; }
.legacy-primary:disabled { opacity: .5; }
.legacy-methods { display:flex; gap:12px; margin-bottom:20px; }
.legacy-methods button { flex:1; padding:10px; border:1px solid #e2e8f0; border-radius:8px; background:#fff; color:#64748b; }
.legacy-methods button[aria-pressed="true"] { color:#4f46e5; border-color:#a5b4fc; background:#eef2ff; }
.legacy-error { color:#b91c1c; font-size:14px; line-height:1.7; }
button:focus-visible,input:focus-visible { outline:3px solid #a5b4fc; outline-offset:2px; }
</style>
