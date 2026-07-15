<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getMe } from '@/api/app'
import type { User } from '@/api/types'
import {
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences
} from '@/domain/user-preferences'

const user = ref<User | null>(null)
const preferences = ref<UserPreferences>(loadUserPreferences())
const notice = ref('')

onMounted(async () => {
  const response = await getMe()
  user.value = response.data
})

function savePreferences() {
  saveUserPreferences(preferences.value)
  notice.value = '偏好已保存，并已应用到当前设备。'
  window.setTimeout(() => {
    notice.value = ''
  }, 2500)
}
</script>

<template>
  <section class="page settings-page">
    <div>
      <h1>设置</h1>
      <p class="muted">调整 Lyle 在当前设备上的显示与交互偏好。</p>
    </div>

    <p v-if="notice" class="alert success" role="status">{{ notice }}</p>

    <div class="settings-grid">
      <article class="item settings-card">
        <div>
          <h2>显示密度</h2>
          <p class="muted">选择更舒展的布局，或在小屏上显示更多内容。</p>
        </div>
        <div class="segmented" aria-label="显示密度">
          <button type="button" :class="{ active: preferences.density === 'comfortable' }" @click="preferences.density = 'comfortable'">舒适</button>
          <button type="button" :class="{ active: preferences.density === 'compact' }" @click="preferences.density = 'compact'">紧凑</button>
        </div>
      </article>

      <article class="item settings-card">
        <div>
          <h2>减少动态效果</h2>
          <p class="muted">减少动画和滚动过渡，让界面更稳定、更易阅读。</p>
        </div>
        <label class="preference-switch">
          <input v-model="preferences.reduceMotion" type="checkbox" />
          <span>{{ preferences.reduceMotion ? '已开启' : '未开启' }}</span>
        </label>
      </article>
    </div>

    <button class="save-preferences" type="button" @click="savePreferences">保存偏好</button>

    <article class="item account-card">
      <div>
        <h2>账号</h2>
        <p class="muted">当前登录身份与可用权限。</p>
      </div>
      <div class="account-summary">
        <strong>{{ user?.username || '正在读取账号' }}</strong>
        <span>{{ user?.role === 'ADMIN' ? '管理员账号' : '个人账号' }}</span>
      </div>
      <nav class="account-links" aria-label="账号相关设置">
        <RouterLink to="/memory">管理记忆与隐私</RouterLink>
        <RouterLink to="/connections">管理外部连接</RouterLink>
      </nav>
    </article>

    <details class="technical-settings">
      <summary>系统技术信息</summary>
      <p>仅供故障排查使用，普通使用无需关注。</p>
      <dl>
        <div><dt>账号编号</dt><dd>{{ user?.id || '—' }}</dd></div>
        <div><dt>鉴权</dt><dd>JWT + 内部服务 Token</dd></div>
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
</template>

<style scoped>
.settings-page { width: min(100%, 920px); margin: 0 auto; }.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }.settings-card { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }.settings-card h2, .account-card h2 { margin: 0; }.settings-card p, .account-card p { margin: 5px 0 0; }.preference-switch { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; font-weight: 700; }.preference-switch input { width: 20px; height: 20px; }.save-preferences { width: fit-content; min-width: 140px; }.account-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-4); }.account-summary { display: grid; gap: 4px; text-align: right; }.account-summary span { color: var(--muted-foreground); }.account-links { display: flex; flex-wrap: wrap; grid-column: 1 / -1; gap: var(--space-3); }.account-links a { color: var(--primary); font-weight: 700; }.technical-settings { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: var(--space-4); color: var(--muted-foreground); }.technical-settings summary { cursor: pointer; color: var(--foreground); font-weight: 700; }.technical-settings p { font-size: 13px; }.technical-settings dl { display: grid; gap: 8px; margin: var(--space-3) 0 0; }.technical-settings dl > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: var(--space-3); }.technical-settings dd { margin: 0; overflow-wrap: anywhere; }.developer-tools { margin-top: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-4); }.developer-tools h3 { margin: 0; color: var(--foreground); font-size: 14px; }.developer-tools .button-link { margin-top: var(--space-2); text-decoration: none; }
@media (max-width: 720px) { .settings-grid { grid-template-columns: 1fr; }.settings-card, .account-card { align-items: stretch; grid-template-columns: 1fr; }.account-summary { text-align: left; }.save-preferences { width: 100%; } }
</style>
