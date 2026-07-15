import {
  computed,
  onBeforeUnmount,
  onMounted,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { listAgentReminders, markAgentReminderRead } from '@/api/app'
import type { AgentReminderItem } from '@/api/types'

const DEFAULT_POLL_INTERVAL = 60_000
const DEFAULT_REMINDER_LIMIT = 20

export interface UseReminderPollingOptions {
  enabled?: MaybeRefOrGetter<boolean>
  pollInterval?: number
  limit?: number
  onNotificationClick?: (reminder: AgentReminderItem) => void
}

function supportsBrowserNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function getNotificationPermission(): NotificationPermission {
  return supportsBrowserNotifications() ? Notification.permission : 'denied'
}

export function useReminderPolling(options: UseReminderPollingOptions = {}) {
  const reminders = ref<AgentReminderItem[]>([])
  const isRefreshing = ref(false)
  const markingReminderId = ref<number | null>(null)
  const error = ref<unknown | null>(null)
  const notificationPermission = ref<NotificationPermission>(getNotificationPermission())
  const canUseBrowserNotifications = computed(supportsBrowserNotifications)
  const notifiedReminderIds = new Set<number>()

  let reminderTimer: number | undefined
  let refreshPromise: Promise<void> | null = null

  const isEnabled = () => options.enabled === undefined || toValue(options.enabled)

  function notifyUnreadReminders(items: AgentReminderItem[]) {
    if (!supportsBrowserNotifications() || Notification.permission !== 'granted') return

    for (const item of items.slice(0, 3)) {
      if (notifiedReminderIds.has(item.id)) continue

      try {
        const notification = new Notification(item.title || 'Lyle AI 提醒', {
          body: item.message,
          tag: `lyle-reminder-${item.id}`
        })
        notifiedReminderIds.add(item.id)
        notification.onclick = () => {
          window.focus()
          notification.close()
          options.onNotificationClick?.(item)
        }
      } catch (notificationError) {
        error.value = notificationError
      }
    }
  }

  async function performRefresh() {
    if (!isEnabled()) {
      reminders.value = []
      return
    }

    isRefreshing.value = true
    try {
      const response = await listAgentReminders(options.limit ?? DEFAULT_REMINDER_LIMIT)
      if (!isEnabled()) {
        reminders.value = []
        return
      }

      reminders.value = response.data.items.filter((item) => item.status !== 'read')
      error.value = null
      notifyUnreadReminders(reminders.value)
    } catch (refreshError) {
      reminders.value = []
      error.value = refreshError
    } finally {
      isRefreshing.value = false
    }
  }

  async function refreshReminders() {
    if (refreshPromise) return refreshPromise

    refreshPromise = performRefresh()
    try {
      await refreshPromise
    } finally {
      refreshPromise = null
    }
  }

  async function readReminder(id: number) {
    if (markingReminderId.value !== null) return

    markingReminderId.value = id
    try {
      await markAgentReminderRead(id)
      reminders.value = reminders.value.filter((item) => item.id !== id)
      error.value = null
      await refreshReminders()
      // A refresh that started before the read request may still contain the old item.
      reminders.value = reminders.value.filter((item) => item.id !== id)
    } catch (readError) {
      error.value = readError
    } finally {
      markingReminderId.value = null
    }
  }

  async function enableBrowserNotifications() {
    if (!supportsBrowserNotifications()) return

    try {
      notificationPermission.value = await Notification.requestPermission()
      if (notificationPermission.value === 'granted') {
        notifyUnreadReminders(reminders.value)
      }
    } catch (permissionError) {
      error.value = permissionError
    }
  }

  function clearReminders() {
    reminders.value = []
    error.value = null
    notifiedReminderIds.clear()
  }

  function startPolling() {
    if (reminderTimer || typeof window === 'undefined') return
    void refreshReminders()
    reminderTimer = window.setInterval(
      () => void refreshReminders(),
      options.pollInterval ?? DEFAULT_POLL_INTERVAL
    )
  }

  function stopPolling() {
    if (reminderTimer !== undefined) {
      window.clearInterval(reminderTimer)
      reminderTimer = undefined
    }
  }

  watch(isEnabled, (enabled) => {
    if (enabled) {
      void refreshReminders()
    } else {
      clearReminders()
    }
  })

  onMounted(startPolling)
  onBeforeUnmount(stopPolling)

  return {
    reminders: readonly(reminders),
    isRefreshing: readonly(isRefreshing),
    markingReminderId: readonly(markingReminderId),
    error: readonly(error),
    notificationPermission: readonly(notificationPermission),
    canUseBrowserNotifications,
    refreshReminders,
    readReminder,
    enableBrowserNotifications,
    clearReminders,
    startPolling,
    stopPolling
  }
}
