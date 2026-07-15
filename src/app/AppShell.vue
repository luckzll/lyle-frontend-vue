<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BellRing } from '@lucide/vue'
import { clearAuth, getCurrentUser } from '@/auth'
import type { User } from '@/api/types'
import { useExecutionBadgePolling } from '@/composables/useExecutionBadgePolling'
import { useReminderPolling } from '@/composables/useReminderPolling'
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'
import MobileNavigation from './MobileNavigation.vue'

const SIDEBAR_PREFERENCE_KEY = 'lyle-ui:v4.2:sidebar-collapsed'

function initialSidebarState(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'true'
  } catch {
    return false
  }
}

const route = useRoute()
const router = useRouter()
const currentUser = ref<User | null>(getCurrentUser())
const sidebarCollapsed = ref(initialSidebarState())
const mobileNavigationOpen = ref(false)
const pageTitle = computed(() => (
  typeof route.meta.title === 'string' && route.meta.title.trim()
    ? route.meta.title
    : 'Lyle AI'
))

const {
  reminders,
  markingReminderId,
  notificationPermission,
  canUseBrowserNotifications,
  refreshReminders,
  readReminder,
  enableBrowserNotifications,
  clearReminders
} = useReminderPolling({
  enabled: computed(() => Boolean(currentUser.value)),
  onNotificationClick: () => {
    void router.push('/tasks')
  }
})

const {
  count: executionAttentionCount,
  refreshCount: refreshExecutionAttentionCount,
  clearCount: clearExecutionAttentionCount
} = useExecutionBadgePolling({
  enabled: computed(() => Boolean(currentUser.value))
})

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

async function logout() {
  clearAuth()
  currentUser.value = null
  mobileNavigationOpen.value = false
  clearReminders()
  clearExecutionAttentionCount()
  await router.push('/login')
}

watch(sidebarCollapsed, (collapsed) => {
  try {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(collapsed))
  } catch {
    // The preference is optional when storage is unavailable.
  }
})

watch(
  () => route.fullPath,
  () => {
    mobileNavigationOpen.value = false
    currentUser.value = getCurrentUser()
    if (currentUser.value) {
      void refreshReminders()
      void refreshExecutionAttentionCount()
    } else {
      clearReminders()
      clearExecutionAttentionCount()
    }
  }
)
</script>

<template>
  <div class="lyle-shell" :class="{ 'lyle-shell--collapsed': sidebarCollapsed }">
    <div class="lyle-shell__sidebar-frame">
      <AppSidebar
        :collapsed="sidebarCollapsed"
        :user="currentUser"
        :reminder-count="reminders.length"
        :execution-count="executionAttentionCount"
        @logout="logout"
      />
    </div>

    <div class="lyle-shell__workspace">
      <AppHeader
        :title="pageTitle"
        :collapsed="sidebarCollapsed"
        :user="currentUser"
        :reminder-count="reminders.length"
        @toggle-sidebar="toggleSidebar"
        @open-mobile-navigation="mobileNavigationOpen = true"
      />

      <main class="lyle-shell__main">
        <section v-if="reminders.length > 0" class="lyle-reminder" aria-live="polite">
          <div class="lyle-reminder__message">
            <span class="lyle-reminder__icon" aria-hidden="true">
              <BellRing :size="18" :stroke-width="1.8" />
            </span>
            <div>
              <strong>{{ reminders[0].title || '提醒' }}</strong>
              <p>{{ reminders[0].message }}</p>
            </div>
          </div>
          <div class="lyle-reminder__actions">
            <button
              v-if="notificationPermission !== 'granted' && canUseBrowserNotifications"
              class="lyle-reminder__button"
              type="button"
              @click="enableBrowserNotifications"
            >
              开启通知
            </button>
            <RouterLink class="lyle-reminder__button lyle-reminder__button--primary" to="/tasks">
              查看
            </RouterLink>
            <button
              class="lyle-reminder__button"
              type="button"
              :disabled="markingReminderId === reminders[0].id"
              @click="readReminder(reminders[0].id)"
            >
              {{ markingReminderId === reminders[0].id ? '处理中…' : '已读' }}
            </button>
          </div>
        </section>

        <RouterView />
      </main>
    </div>

    <MobileNavigation
      :open="mobileNavigationOpen"
      :user="currentUser"
      :reminder-count="reminders.length"
      :execution-count="executionAttentionCount"
      @update:open="mobileNavigationOpen = $event"
      @logout="logout"
    />
  </div>
</template>

<style scoped>
.lyle-shell {
  display: grid;
  min-height: 100dvh;
  grid-template-columns: var(--lyle-sidebar-width) minmax(0, 1fr);
  background: var(--background);
  color: var(--foreground);
  transition: grid-template-columns var(--lyle-duration-normal) var(--lyle-ease-standard);
}

.lyle-shell--collapsed {
  grid-template-columns: var(--lyle-sidebar-width-collapsed) minmax(0, 1fr);
}

.lyle-shell__sidebar-frame {
  position: sticky;
  top: 0;
  z-index: 40;
  width: 100%;
  height: 100dvh;
  min-width: 0;
}

.lyle-shell__workspace {
  min-width: 0;
}

.lyle-shell__main {
  display: flex;
  min-width: 0;
  min-height: calc(100dvh - var(--lyle-header-height));
  flex-direction: column;
  padding: var(--lyle-space-6);
}

.lyle-shell__main :deep(.page) {
  min-height: 0;
  flex: 1;
}

.lyle-reminder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lyle-space-4);
  margin: 0 0 var(--lyle-space-4);
  border: 1px solid var(--lyle-color-sky-200);
  border-radius: var(--lyle-radius-lg);
  background: var(--lyle-color-sky-50);
  padding: var(--lyle-space-3) var(--lyle-space-4);
  color: var(--lyle-color-slate-800);
  box-shadow: var(--lyle-shadow-sm);
}

.lyle-reminder__message,
.lyle-reminder__actions {
  display: flex;
  align-items: center;
}

.lyle-reminder__message {
  min-width: 0;
  gap: var(--lyle-space-3);
}

.lyle-reminder__icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  place-items: center;
  border-radius: var(--lyle-radius-full);
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
}

.lyle-reminder__message strong {
  font-size: 0.83rem;
}

.lyle-reminder__message p {
  margin: 0.15rem 0 0;
  overflow-wrap: anywhere;
  color: var(--lyle-color-slate-600);
  font-size: 0.8rem;
  line-height: 1.45;
}

.lyle-reminder__actions {
  flex: 0 0 auto;
  gap: var(--lyle-space-2);
}

.lyle-reminder__button {
  display: inline-flex;
  min-height: 2.25rem;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--lyle-color-sky-200);
  border-radius: var(--lyle-radius-md);
  background: var(--lyle-color-white);
  color: var(--lyle-color-slate-700);
  padding: 0.45rem 0.7rem;
  font-size: 0.78rem;
  font-weight: 650;
  white-space: nowrap;
}

.lyle-reminder__button:hover {
  background: var(--lyle-color-slate-50);
}

.lyle-reminder__button--primary {
  border-color: var(--info);
  background: var(--info);
  color: var(--lyle-color-white);
}

.lyle-reminder__button--primary:hover {
  background: color-mix(in srgb, var(--info) 88%, black);
}

@media (max-width: 959px) {
  .lyle-shell,
  .lyle-shell--collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .lyle-shell__sidebar-frame {
    display: none;
  }

  .lyle-shell__main {
    padding: var(--lyle-space-4);
  }
}

@media (max-width: 639px) {
  .lyle-shell__main {
    padding: var(--lyle-space-3);
  }

  .lyle-reminder {
    align-items: stretch;
    flex-direction: column;
  }

  .lyle-reminder__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lyle-reminder__actions > :first-child:nth-last-child(3) {
    grid-column: 1 / -1;
  }
}
</style>
