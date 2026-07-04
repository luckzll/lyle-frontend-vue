<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearAuth, getCurrentUser } from '@/auth'
import { listAgentReminders, markAgentReminderRead } from '@/api/app'
import type { AgentReminderItem, User } from '@/api/types'

const route = useRoute()
const router = useRouter()
const isLoginPage = computed(() => route.name === 'login')
const canUseBrowserNotifications = computed(() => 'Notification' in window)
const currentUser = ref<User | null>(getCurrentUser())
const reminders = ref<AgentReminderItem[]>([])
const notificationPermission = ref<'default' | 'denied' | 'granted'>(
  'Notification' in window ? Notification.permission : 'denied'
)
const notifiedReminderIds = new Set<number>()
let reminderTimer: number | undefined

watch(() => route.fullPath, () => {
  currentUser.value = getCurrentUser()
  if (currentUser.value) {
    refreshReminders()
  } else {
    reminders.value = []
  }
})

async function logout() {
  clearAuth()
  currentUser.value = null
  reminders.value = []
  await router.push('/login')
}

async function refreshReminders() {
  if (!currentUser.value) return
  try {
    const response = await listAgentReminders(20)
    reminders.value = response.data.items.filter((item) => item.status !== 'read')
    notifyUnreadReminders(reminders.value)
  } catch {
    reminders.value = []
  }
}

async function readReminder(id: number) {
  await markAgentReminderRead(id)
  await refreshReminders()
}

async function enableBrowserNotifications() {
  if (!('Notification' in window)) return
  notificationPermission.value = await Notification.requestPermission()
  if (notificationPermission.value === 'granted') {
    notifyUnreadReminders(reminders.value)
  }
}

function notifyUnreadReminders(items: AgentReminderItem[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  for (const item of items.slice(0, 3)) {
    if (notifiedReminderIds.has(item.id)) continue
    notifiedReminderIds.add(item.id)
    const notification = new Notification(item.title || 'Lyle AI 提醒', {
      body: item.message,
      tag: `lyle-reminder-${item.id}`
    })
    notification.onclick = () => {
      window.focus()
      router.push('/tasks')
    }
  }
}

onMounted(() => {
  refreshReminders()
  reminderTimer = window.setInterval(refreshReminders, 60_000)
})

onBeforeUnmount(() => {
  if (reminderTimer) window.clearInterval(reminderTimer)
})
</script>

<template>
  <RouterView v-if="isLoginPage" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">Lyle AI</div>
      <RouterLink to="/dashboard" active-class="is-active">工作台</RouterLink>
      <RouterLink to="/" active-class="is-active">聊天</RouterLink>
      <RouterLink to="/knowledge-bases" active-class="is-active">知识库</RouterLink>
      <RouterLink to="/conversations" active-class="is-active">会话</RouterLink>
      <RouterLink to="/memory" active-class="is-active">记忆</RouterLink>
      <RouterLink to="/tasks" active-class="is-active">任务</RouterLink>
      <RouterLink to="/projects" active-class="is-active">项目</RouterLink>
      <RouterLink to="/connectors" active-class="is-active">连接器</RouterLink>
      <RouterLink to="/operations" active-class="is-active">操作</RouterLink>
      <RouterLink v-if="currentUser?.role === 'ADMIN'" to="/evaluation" active-class="is-active">评测</RouterLink>
      <RouterLink v-if="currentUser?.role === 'ADMIN'" to="/prompts" active-class="is-active">Prompt</RouterLink>
      <RouterLink to="/settings" active-class="is-active">设置</RouterLink>
      <RouterLink v-if="currentUser?.role === 'ADMIN'" to="/admin" active-class="is-active">管理</RouterLink>
      <div class="sidebar-footer">
        <span class="muted">{{ currentUser?.username }}</span>
        <button class="secondary" type="button" @click="logout">退出</button>
      </div>
    </aside>
    <main class="main-panel">
      <section v-if="reminders.length > 0" class="reminder-banner">
        <div>
          <strong>提醒</strong>
          <p>{{ reminders[0].message }}</p>
        </div>
        <div class="row">
          <button
            v-if="notificationPermission !== 'granted' && canUseBrowserNotifications"
            class="secondary"
            type="button"
            @click="enableBrowserNotifications"
          >
            开启通知
          </button>
          <RouterLink class="button-link" to="/tasks">查看</RouterLink>
          <button class="secondary" type="button" @click="readReminder(reminders[0].id)">已读</button>
        </div>
      </section>
      <RouterView />
    </main>
  </div>
</template>
