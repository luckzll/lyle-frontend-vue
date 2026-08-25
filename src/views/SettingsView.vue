<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { KeyRound, Laptop, LogOut, ShieldCheck, UserRound } from '@lucide/vue'
import {
  changePassword,
  getAuthSession,
  getMe,
  type AuthSessionInfo
} from '@/api/app'
import type { User } from '@/api/types'
import { logoutAllDevices, logoutCurrentDevice, setAuth } from '@/auth'
import { useToast } from '@/composables/useToast'
import { formatBeijingTimeShort } from '@/domain/date-time'
import {
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences
} from '@/domain/user-preferences'
import SettingsFrame from '@/components/settings/SettingsFrame.vue'

const user = ref<User | null>(null)
const session = ref<AuthSessionInfo | null>(null)
const loading = ref(true)
const accountLoadError = ref(false)
const sessionLoadError = ref(false)
const passwordSubmitting = ref(false)
const logoutAllSubmitting = ref(false)
const logoutCurrentSubmitting = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const preferences = ref<UserPreferences>(loadUserPreferences())
const preferenceNotice = ref('')
const { show } = useToast()

const accountStatus = computed(() => {
  if (accountLoadError.value || !user.value) return '未知'
  return user.value.status === 'DISABLED' ? '已停用' : '正常'
})

onMounted(async () => {
  const [userResult, sessionResult] = await Promise.allSettled([getMe(), getAuthSession()])
  if (userResult.status === 'fulfilled') user.value = userResult.value.data
  else accountLoadError.value = true
  if (sessionResult.status === 'fulfilled') session.value = sessionResult.value.data
  else sessionLoadError.value = true
  loading.value = false
})

async function submitPassword() {
  passwordError.value = ''
  if (!currentPassword.value || !newPassword.value) {
    passwordError.value = '请输入当前密码和新密码。'
    return
  }
  if (newPassword.value.length < 8 || newPassword.value.length > 128) {
    passwordError.value = '新密码需为 8～128 个字符。'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = '两次输入的新密码不一致。'
    return
  }
  passwordSubmitting.value = true
  try {
    const response = await changePassword(currentPassword.value, newPassword.value)
    setAuth(response.data.user, response.data.accessToken, response.data.expiresInSeconds)
    user.value = response.data.user
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    show('密码已更新', { message: '其他设备已退出，当前设备可继续使用。' })
  } catch (error: any) {
    passwordError.value = error?.response?.data?.detail
      || error?.response?.data?.message
      || '密码修改失败，请核对当前密码后重试。'
  } finally {
    passwordSubmitting.value = false
  }
}

async function logoutEverywhere() {
  if (!window.confirm('退出全部设备后，当前设备也需要重新登录。确定继续吗？')) return
  logoutAllSubmitting.value = true
  try {
    await logoutAllDevices()
    window.location.assign('/login')
  } catch {
    show('退出失败', { message: '登录状态可能已变化，请刷新后重试。', tone: 'danger' })
    logoutAllSubmitting.value = false
  }
}

async function logoutHere() {
  logoutCurrentSubmitting.value = true
  await logoutCurrentDevice()
  window.location.assign('/login')
}

function savePreferences() {
  saveUserPreferences(preferences.value)
  preferenceNotice.value = '偏好已保存，并已应用到当前设备。'
  window.setTimeout(() => {
    preferenceNotice.value = ''
  }, 2500)
}

function formatDateTime(value?: string | null) {
  return formatBeijingTimeShort(value, value || '暂无记录')
}
</script>

<template>
  <SettingsFrame>
    <section class="security-page" aria-labelledby="security-title">
      <header class="security-heading">
        <div>
          <h2 id="security-title">账号与安全</h2>
          <p>管理密码、当前登录状态和设备会话。</p>
        </div>
        <span class="security-status" :class="{ loading, error: accountLoadError }">
          <ShieldCheck :size="16" aria-hidden="true" />
          {{ loading ? '读取中' : accountLoadError ? '账号读取失败' : `账号${accountStatus}` }}
        </span>
      </header>

      <div class="security-grid">
        <article class="security-card identity-card">
          <div class="security-card__icon"><UserRound :size="20" aria-hidden="true" /></div>
          <div>
            <h3>账号信息</h3>
            <p>你的登录身份和最近登录记录。</p>
          </div>
          <dl>
            <div><dt>用户名</dt><dd>{{ accountLoadError ? '读取失败' : user?.username || '正在读取' }}</dd></div>
            <div><dt>账号状态</dt><dd><span class="account-active" :class="{ unknown: accountLoadError }">{{ accountStatus }}</span></dd></div>
            <div><dt>最近登录</dt><dd>{{ accountLoadError ? '读取失败' : formatDateTime(user?.lastLoginAt) }}</dd></div>
          </dl>
        </article>

        <article class="security-card session-card">
          <div class="security-card__icon"><Laptop :size="20" aria-hidden="true" /></div>
          <div>
            <h3>当前会话</h3>
            <p>{{ sessionLoadError ? '暂时无法确认当前会话状态，请稍后重试。' : '当前设备已通过安全会话登录。' }}</p>
          </div>
          <dl>
            <div><dt>当前设备</dt><dd>{{ sessionLoadError ? '读取失败' : '此浏览器' }} <span v-if="!sessionLoadError" class="current-device">当前</span></dd></div>
            <div><dt>登录时间</dt><dd>{{ sessionLoadError ? '读取失败' : formatDateTime(session?.createdAt) }}</dd></div>
            <div><dt>最近活动</dt><dd>{{ sessionLoadError ? '读取失败' : formatDateTime(session?.lastUsedAt) }}</dd></div>
          </dl>
          <button
            class="session-logout"
            type="button"
            :disabled="logoutCurrentSubmitting"
            @click="logoutHere"
          >
            <LogOut :size="15" aria-hidden="true" />
            {{ logoutCurrentSubmitting ? '正在退出…' : '退出当前设备' }}
          </button>
        </article>
      </div>

      <article class="security-card password-card">
        <div class="password-card__heading">
          <div class="security-card__icon"><KeyRound :size="20" aria-hidden="true" /></div>
          <div>
            <h3>修改密码</h3>
            <p>修改后会退出其他设备，当前设备将重新签发登录凭据。</p>
          </div>
        </div>
        <form class="password-form" @submit.prevent="submitPassword">
          <label>
            <span>当前密码</span>
            <input v-model="currentPassword" type="password" autocomplete="current-password" />
          </label>
          <label>
            <span>新密码</span>
            <input v-model="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" />
          </label>
          <label>
            <span>确认新密码</span>
            <input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" />
          </label>
          <p v-if="passwordError" class="form-error" role="alert">{{ passwordError }}</p>
          <button type="submit" :disabled="passwordSubmitting">
            {{ passwordSubmitting ? '正在更新…' : '更新密码' }}
          </button>
        </form>
      </article>

      <article class="security-card danger-card">
        <div>
          <h3>退出全部设备</h3>
          <p>撤销包括当前浏览器在内的全部登录会话，所有设备都需要重新登录。</p>
        </div>
        <button class="danger-action" type="button" :disabled="logoutAllSubmitting" @click="logoutEverywhere">
          <LogOut :size="17" aria-hidden="true" />
          {{ logoutAllSubmitting ? '正在退出…' : '退出全部设备' }}
        </button>
      </article>

      <details class="preference-panel" open>
        <summary>当前设备显示偏好</summary>
        <p v-if="preferenceNotice" class="preference-notice" role="status">{{ preferenceNotice }}</p>
        <div class="preference-fields">
          <label>
            <span>显示密度</span>
            <select v-model="preferences.density">
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </select>
          </label>
          <label class="preference-check">
            <input v-model="preferences.reduceMotion" type="checkbox" />
            <span>减少动态效果</span>
          </label>
          <button type="button" @click="savePreferences">保存偏好</button>
        </div>
      </details>

      <details class="technical-settings">
        <summary>系统技术信息</summary>
        <p>仅供故障排查使用，普通使用无需关注。</p>
        <dl>
          <div><dt>账号编号</dt><dd>{{ user?.id || '—' }}</dd></div>
          <div><dt>鉴权</dt><dd>JWT + 安全会话</dd></div>
          <div><dt>数据服务</dt><dd>Redis / PostgreSQL / Qdrant / Milvus</dd></div>
          <div><dt>知识服务</dt><dd>MinIO + Qdrant RAG</dd></div>
          <div><dt>迁移</dt><dd>Flyway + Alembic</dd></div>
        </dl>
        <div class="developer-tools">
          <h3>开发者工具</h3>
          <p>调试信息只在显式调试模式下展示，不影响普通用户界面。</p>
          <RouterLink class="button-link" to="/?debug=1">进入对话调试模式</RouterLink>
        </div>
      </details>
    </section>
  </SettingsFrame>
</template>

<style scoped>
.security-page { display: grid; gap: 18px; max-width: 980px; margin: 0 auto; }
.security-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.security-heading h2 { margin: 0; color: var(--foreground); font-size: 24px; letter-spacing: -.025em; }
.security-heading p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 14px; }
.security-status { display: inline-flex; align-items: center; gap: 6px; border-radius: 99px; background: var(--success-soft); color: var(--success-strong); padding: 6px 10px; font-size: 12px; font-weight: 700; }
.security-status.loading { background: var(--surface-muted); color: var(--muted-foreground); }
.security-status.error { background: var(--danger-soft); color: var(--danger-strong); }
.security-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.security-card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 18px; box-shadow: var(--shadow-xs); }
.security-card__icon { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border-radius: 9px; background: var(--primary-soft); color: var(--primary); }
.identity-card, .session-card { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 12px; }
.security-card h3 { margin: 0; font-size: 15px; }
.security-card p { margin: 5px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
.security-card dl { display: grid; grid-column: 1 / -1; gap: 0; margin: 8px 0 0; }
.session-logout { display: inline-flex; grid-column: 1 / -1; width: fit-content; align-items: center; gap: 7px; border-color: var(--border); background: var(--surface); color: var(--muted-foreground); }
.security-card dl > div { display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid var(--border); padding: 10px 0; font-size: 13px; }
.security-card dl > div:last-child { padding-bottom: 0; }
.security-card dt { color: var(--muted-foreground); }
.security-card dd { margin: 0; color: var(--foreground); font-weight: 650; text-align: right; }
.account-active, .current-device { border-radius: 99px; background: var(--success-soft); color: var(--success-strong); padding: 3px 7px; font-size: 11px; font-weight: 700; }
.account-active.unknown { background: var(--warning-soft); color: var(--warning-strong); }
.current-device { margin-left: 5px; background: var(--primary-soft); color: var(--primary); }
.password-card { display: grid; gap: 18px; }
.password-card__heading { display: flex; align-items: flex-start; gap: 12px; }
.password-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; align-items: end; gap: 12px; }
.password-form label { display: grid; gap: 7px; color: var(--foreground); font-size: 12px; font-weight: 650; }
.password-form input { height: 40px; }
.password-form button { min-height: 40px; white-space: nowrap; }
.form-error { grid-column: 1 / -1; margin: 0 !important; color: var(--danger-strong) !important; }
.danger-card { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-color: var(--danger-border); background: var(--danger-soft); }
.danger-card p { color: var(--foreground); }
.danger-action { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 8px; border: 1px solid var(--danger-border); background: var(--surface); color: var(--danger-strong); }
.preference-panel { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 14px 18px; }
.preference-panel summary { cursor: pointer; font-size: 13px; font-weight: 700; }
.preference-fields { display: grid; grid-template-columns: minmax(160px, 220px) 1fr auto; align-items: end; gap: 14px; margin-top: 16px; }
.preference-fields label { display: grid; gap: 7px; font-size: 12px; font-weight: 650; }
.preference-check { display: flex !important; min-height: 40px; align-items: center; grid-template-columns: auto 1fr; }
.preference-check input { width: 18px; }
.preference-notice { color: var(--success-strong) !important; }
.technical-settings { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 14px 18px; color: var(--muted-foreground); }
.technical-settings summary { cursor: pointer; color: var(--foreground); font-size: 13px; font-weight: 700; }
.technical-settings p { font-size: 12px; }
.technical-settings dl { display: grid; gap: 8px; margin: 14px 0 0; }
.technical-settings dl > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; }
.technical-settings dd { margin: 0; overflow-wrap: anywhere; }
.developer-tools { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px; }
.developer-tools h3 { margin: 0; color: var(--foreground); font-size: 14px; }
.developer-tools .button-link { display: inline-flex; margin-top: 8px; text-decoration: none; }
@media (max-width: 980px) {
  .password-form { grid-template-columns: 1fr 1fr; }
  .password-form button { width: fit-content; }
}
@media (max-width: 680px) {
  .security-heading, .danger-card { align-items: stretch; flex-direction: column; }
  .security-grid, .password-form, .preference-fields { grid-template-columns: 1fr; }
  .security-status { align-self: flex-start; }
  .danger-action, .password-form button { width: 100%; justify-content: center; }
}
</style>
