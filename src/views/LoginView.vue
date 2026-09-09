<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Mail, Sparkle } from '@lucide/vue'
import { Icon } from '@iconify/vue'
import wechatIcon from '@iconify-icons/simple-icons/wechat'
import EmailAuthForm from '@/components/auth/EmailAuthForm.vue'
import WechatAuthForm from '@/components/auth/WechatAuthForm.vue'
import LegacyMigrationForm from '@/components/auth/LegacyMigrationForm.vue'
import { publicHttp } from '@/api/http'
const route = useRoute(), router = useRouter()
const method = ref<'email' | 'wechat'>(route.query.wechat ? 'wechat' : 'email')
const migrating = ref(false)
async function migrationMode(value: boolean) {
  try { await publicHttp.post('/auth/wechat/cancel', {}); if (!value) await publicHttp.post('/auth/migration/cancel', {}) } catch { /* bounded expiry */ }
  migrating.value = value
}
async function selectMethod(value: 'email' | 'wechat') {
  if (method.value === value) return
  if (value === 'email') {
    // Invalidate QR/link flow before switching, so an old scan cannot replace an email login.
    try { await publicHttp.post('/auth/wechat/cancel', {}) } catch { /* expiry still bounds an unavailable service */ }
    await router.replace({ query: { ...route.query, wechat: undefined } })
  }
  method.value = value
}
function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 'email' : event.key === 'End' ? 'wechat' : method.value === 'email' ? 'wechat' : 'email'
  void selectMethod(next).then(() => document.getElementById(`login-tab-${next}`)?.focus())
}
</script>

<template>
  <main class="email-login-page">
    <aside class="login-story" aria-label="Lyle AI">
      <div class="login-story__content">
        <span class="login-mark"><Sparkle :size="42" fill="currentColor" :stroke-width="1" aria-hidden="true" /></span>
        <p class="login-brand">Lyle AI</p>
        <p class="login-tagline">让想法，继续向前。</p>
        <p class="login-description">更专注的 AI 工作伙伴，<br />陪你把灵感变成真实的成果。</p>
      </div>
    </aside>
    <section class="login-main" aria-labelledby="login-heading">
      <div class="login-content">
        <p class="mobile-brand">Lyle AI</p>
        <header class="login-heading">
          <h1 id="login-heading">{{ migrating ? '继续使用原账号' : '欢迎回来' }}</h1>
          <p>{{ migrating ? '绑定新的登录方式，保留熟悉的一切' : '选择你习惯的方式，继续你的工作' }}</p>
        </header>
        <div v-if="!migrating" class="login-methods" role="tablist" aria-label="登录方式" @keydown="tabKey">
          <button id="login-tab-email" type="button" role="tab" aria-controls="login-panel-email" :aria-selected="method === 'email'" :tabindex="method === 'email' ? 0 : -1" @click="selectMethod('email')"><Mail :size="18" />邮箱登录</button>
          <button id="login-tab-wechat" type="button" role="tab" aria-controls="login-panel-wechat" :aria-selected="method === 'wechat'" :tabindex="method === 'wechat' ? 0 : -1" @click="selectMethod('wechat')"><Icon :icon="wechatIcon" width="19" />微信登录</button>
        </div>
        <LegacyMigrationForm v-if="migrating" />
        <template v-else>
          <div v-if="method === 'email'" id="login-panel-email" role="tabpanel" aria-labelledby="login-tab-email"><EmailAuthForm /></div>
          <div v-if="method === 'wechat'" id="login-panel-wechat" role="tabpanel" aria-labelledby="login-tab-wechat"><WechatAuthForm @email="selectMethod('email')" /></div>
        </template>
        <button class="legacy-entry" type="button" @click="migrationMode(!migrating)">{{ migrating ? '返回邮箱 / 微信登录' : '旧用户名账号？绑定登录方式' }}</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.legacy-entry { display:block; margin:18px auto 0; padding:6px; border:0; background:transparent; color:#64748b; font-size:12px; }
.legacy-entry:focus-visible { outline:3px solid #a5b4fc; outline-offset:2px; }
.login-methods { display: flex; padding: 4px; gap: 4px; background: #f1f3f9; border: 1px solid #e9edf5; border-radius: 12px; margin: 0 0 22px; }
.login-methods button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 42px; padding: 8px 12px; border: 0; border-radius: 8px; color: #64748b; background: transparent; font-size: 15px; font-weight: 600; }
.login-methods button[aria-selected="true"] { background: #fff; color: #4f46e5; box-shadow: 0 1px 4px #0f172a0c; }
.login-methods button:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
.email-login-page { display: grid; grid-template-columns: 42% minmax(0, 1fr); min-height: 100dvh; background: #fff; color: #0f172a; }
.login-story { position: relative; display: flex; align-items: center; background: #eef2ff url('@/assets/auth/lyle-email-login-waves.png') center / cover no-repeat; padding: 64px clamp(40px, 7.5vw, 116px); }
.login-story__content { position: relative; margin-top: -220px; }
.login-mark { display: grid; place-items: center; width: 76px; height: 76px; border-radius: 18px; color: white; background: #4f46e5; }
.login-brand { margin: 24px 0 10px; font-size: clamp(38px, 3.6vw, 54px); line-height: 1.15; font-weight: 750; letter-spacing: -.045em; }
.login-tagline { margin: 0; color: #52617d; font-size: clamp(23px, 2.5vw, 36px); line-height: 1.5; white-space: nowrap; }
.login-description { margin: 28px 0 0; color: #657798; font-size: 18px; line-height: 1.8; }
.login-main { display: flex; align-items: flex-start; justify-content: center; padding: 124px clamp(40px, 8.3vw, 120px) 72px; }
.login-content { width: 100%; max-width: 596px; }
.login-heading { margin-bottom: 38px; }
.login-heading h1 { margin: 0; font-size: 44px; line-height: 1.3; font-weight: 750; letter-spacing: -.035em; }
.login-heading p { margin: 12px 0 0; color: #64748b; font-size: 18px; line-height: 1.6; }
.mobile-brand { display: none; }
@media (max-width: 1050px) { .login-story { padding: 40px; } .login-main { padding: 56px 40px; } .login-description { font-size: 16px; } }
@media (max-width: 760px) { .email-login-page { display: block; } .login-story { display: none; } .login-main { min-height: 100dvh; padding: 40px 24px; } .mobile-brand { display: block; color: #4f46e5; font-size: 25px; font-weight: 750; margin: 0 0 40px; } .login-heading h1 { font-size: 32px; } .login-heading p { font-size: 16px; } .login-heading { margin-bottom: 30px; } }
.login-main { box-sizing: border-box; align-items: center; padding-top: 28px; padding-bottom: 28px; }
.login-heading { margin-bottom: 20px; }
.login-heading h1 { font-size: 36px; }
.login-heading p { margin-top: 8px; font-size: 16px; }
.login-story__content { margin-top: 0; }
.login-content :deep(.email-auth form) { gap: 16px; }
.login-content :deep(.input-shell), .login-content :deep(.email-submit) { min-height: 48px; }
.login-content :deep(.captcha-panel) { max-width: 320px; }
.login-content :deep(.email-footnote) { margin-top: 0; }
@media (max-height: 800px) {
  .login-main { padding-top: 16px; padding-bottom: 16px; }
  .login-heading { margin-bottom: 14px; }
  .login-heading h1 { font-size: 30px; }
  .login-content :deep(.email-auth form) { gap: 12px; }
  .login-content :deep(.captcha-panel) { max-width: 280px; }
}
@media (max-width: 760px) {
  .login-main { align-items: flex-start; padding-top: 16px; padding-bottom: 16px; }
  .mobile-brand { margin-bottom: 12px; font-size: 21px; }
  .login-heading h1 { font-size: 28px; }
  .login-heading { margin-bottom: 14px; }
  .login-content :deep(.email-auth form) { gap: 12px; }
  .login-content :deep(.captcha-panel) { max-width: 280px; }
}
</style>
