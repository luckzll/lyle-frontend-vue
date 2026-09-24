<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Bell, CalendarDays, CheckCheck, ChevronDown, ClipboardList, MessageSquare, Plus, RefreshCw } from '@lucide/vue'
import {
  createAgentTodo,
  deleteAgentCalendar,
  deleteAgentTodo,
  listAgentCalendar,
  listAgentReminders,
  listAgentTodos,
  markAgentReminderRead,
  trackProductEvent,
  updateAgentTodoDueAt,
  updateAgentCalendarStatus,
  updateAgentTodoStatus
} from '@/api/app'
import type { AgentCalendarItem, AgentReminderItem, AgentTodoItem } from '@/api/types'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import { formatSourceReference } from '@/domain/source-reference'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import DetailDrawer from '@/components/layout/DetailDrawer.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useAsyncAction } from '@/composables/useAsyncAction'
import { toAppError } from '@/api/errors'

type TaskDataSource = 'todos' | 'calendar' | 'reminders'

const TASK_SOURCE_LABELS: Record<TaskDataSource, string> = {
  todos: '待办',
  calendar: '日历',
  reminders: '提醒'
}

const todos = ref<AgentTodoItem[]>([])
const calendar = ref<AgentCalendarItem[]>([])
const reminders = ref<AgentReminderItem[]>([])
const loading = ref(false)
const hasLoaded = ref(false)
const sourceErrors = ref<Record<TaskDataSource, string>>({
  todos: '',
  calendar: '',
  reminders: ''
})
const activeTab = ref<'open' | 'today' | 'upcoming' | 'overdue' | 'done' | 'cancelled' | 'all'>('open')
const dueEdits = ref<Record<number, string>>({})
const notice = ref('')
const newTodoTitle = ref('')
const newTodoDueAt = ref('')
const showCreateTodo = ref(false)
const createTodoError = ref('')
const newTodoInput = ref<HTMLInputElement | null>(null)
const todoListHeading = ref<HTMLElement | null>(null)
let createTodoTrigger: HTMLElement | null = null
const selectedDate = ref(startOfDay(new Date()).toISOString())
const calendarWindowStart = ref(startOfWeek(new Date()).toISOString())
const calendarScope = ref<'day' | 'week'>('day')
const pendingDeleteTodoId = ref<number | null>(null)
const pendingDeleteCalendarId = ref<number | null>(null)
const { isPending: isActionPending, run: runAction } = useAsyncAction()

const failedSources = computed(() => (Object.keys(TASK_SOURCE_LABELS) as TaskDataSource[])
  .filter((source) => Boolean(sourceErrors.value[source])))
const allSourcesFailed = computed(() => hasLoaded.value && failedSources.value.length === 3)
const partialSourcesFailed = computed(() => hasLoaded.value && failedSources.value.length > 0 && !allSourcesFailed.value)
const failedSourceLabel = computed(() => failedSources.value.map((source) => TASK_SOURCE_LABELS[source]).join('、'))
const allFailureMessage = computed(() => Array.from(new Set(failedSources.value
  .map((source) => sourceErrors.value[source])
  .filter(Boolean))).join('；') || '任务数据暂时无法加载，请稍后重试。')
const hasAnyData = computed(() => todos.value.length + calendar.value.length + reminders.value.length > 0)
const isEmpty = computed(() => hasLoaded.value && !loading.value && !failedSources.value.length && !hasAnyData.value)
const todoFilters = [
  { value: 'open', label: '进行中' }, { value: 'today', label: '今日' },
  { value: 'upcoming', label: '即将到期' }, { value: 'overdue', label: '逾期' },
  { value: 'done', label: '已完成' }, { value: 'cancelled', label: '已取消' }, { value: 'all', label: '全部' }
] as const
const todoEmptyState = computed(() => {
  if (!todos.value.length) return { title: '先记下一件待办', description: '把要做的事记在这里，也可以在聊天里让 Lyle 帮你整理。', target: null }
  if (activeTab.value === 'open' && todos.value.every((item) => item.status === 'done')) {
    return { title: '待办都完成了', description: '已完成的事项都保留着，随时可以回顾。', target: 'done' as const }
  }
  const titles = {
    open: '当前没有进行中的待办', today: '今天没有到期待办', upcoming: '近期没有到期待办',
    overdue: '没有逾期待办', done: '还没有已完成的待办', cancelled: '没有已取消的待办', all: '暂无待办'
  }
  return { title: titles[activeTab.value], description: '这个筛选下暂时没有事项，可以切换筛选查看其他待办。', target: 'all' as const }
})

const visibleTodos = computed(() => {
  const source = activeTab.value === 'open'
    ? todos.value.filter((item) => item.status === 'open')
    : activeTab.value === 'today'
      ? todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt))
      : activeTab.value === 'upcoming'
        ? todos.value.filter((item) => isUpcoming(item))
        : activeTab.value === 'overdue'
          ? todos.value.filter((item) => isOverdue(item))
        : activeTab.value === 'done'
          ? todos.value.filter((item) => item.status === 'done')
          : activeTab.value === 'cancelled'
            ? todos.value.filter((item) => item.status === 'cancelled')
            : todos.value
  return sortTodos(dedupeTodos(source))
})

const unreadReminders = computed(() => reminders.value.filter((item) => item.status !== 'read'))
const upcomingEvents = computed(() => calendar.value.filter((item) => item.status === 'scheduled'))
const openTodos = computed(() => todos.value.filter((item) => item.status === 'open'))
const overdueTodos = computed(() => todos.value.filter((item) => isOverdue(item)))
const todayTodos = computed(() => todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt)))
const upcomingTodos = computed(() => todos.value.filter((item) => isUpcoming(item)))
const duplicateTodoCount = computed(() => todos.value.length - dedupeTodos(todos.value).length)
const calendarDays = computed(() => buildCalendarDays())
const todayCalendarDay = computed(() => calendarDayStats(new Date()))
const tomorrowCalendarDay = computed(() => calendarDayStats(dateOffset(1)))
const selectedDayTodos = computed(() => sortTodos(openTodos.value.filter((item) => isSameDate(item.dueAt, selectedDate.value))))
const selectedDayEvents = computed(() => upcomingEvents.value.filter((item) => isSameDate(item.startsAt, selectedDate.value)))
const selectedDayReminders = computed(() => reminders.value.filter((item) => isSameDate(item.createdAt, selectedDate.value)))
const selectedDayTotal = computed(() => selectedDayTodos.value.length + selectedDayEvents.value.length + selectedDayReminders.value.length)
const tomorrowTodos = computed(() => {
  const tomorrow = dateOffset(1).toISOString()
  return openTodos.value.filter((item) => isSameDate(item.dueAt, tomorrow))
})
const weekDueTodos = computed(() => openTodos.value.filter((item) => isInDateWindow(item.dueAt, calendarWindowStart.value, 7)))
const calendarTotal = computed(() => calendarScope.value === 'week' ? weekDueTodos.value.length : selectedDayTotal.value)

onMounted(refresh)

async function refresh(showLoading = true) {
  if (showLoading) loading.value = true
  try {
    const [todoResponse, calendarResponse, reminderResponse] = await Promise.allSettled([
      listAgentTodos(),
      listAgentCalendar(),
      listAgentReminders()
    ])
    const nextErrors: Record<TaskDataSource, string> = { todos: '', calendar: '', reminders: '' }

    if (todoResponse.status === 'fulfilled' && Array.isArray(todoResponse.value.data.items)) {
      todos.value = todoResponse.value.data.items
    } else {
      nextErrors.todos = sourceLoadError(
        todoResponse.status === 'rejected' ? todoResponse.reason : undefined,
        '待办加载失败，请稍后重试。'
      )
    }

    if (calendarResponse.status === 'fulfilled' && Array.isArray(calendarResponse.value.data.items)) {
      calendar.value = calendarResponse.value.data.items
    } else {
      nextErrors.calendar = sourceLoadError(
        calendarResponse.status === 'rejected' ? calendarResponse.reason : undefined,
        '日历加载失败，请稍后重试。'
      )
    }

    if (reminderResponse.status === 'fulfilled' && Array.isArray(reminderResponse.value.data.items)) {
      reminders.value = reminderResponse.value.data.items
    } else {
      nextErrors.reminders = sourceLoadError(
        reminderResponse.status === 'rejected' ? reminderResponse.reason : undefined,
        '提醒加载失败，请稍后重试。'
      )
    }

    sourceErrors.value = nextErrors
    hasLoaded.value = true
  } finally {
    if (showLoading) loading.value = false
  }
}

function sourceLoadError(error: unknown, fallback: string) {
  return toAppError(error, fallback).message || fallback
}

async function createTodoManually() {
  const title = newTodoTitle.value.trim()
  if (!title || isCreatingTodo()) return
  createTodoError.value = ''
  try {
    const created = await runAction('todo-create', async () => {
      const response = await createAgentTodo(title, newTodoDueAt.value ? new Date(newTodoDueAt.value).toISOString() : null)
      return response.data
    })
    if (!created) return
    todos.value = [created, ...todos.value.filter((item) => item.id !== created.id)]
    newTodoTitle.value = ''
    newTodoDueAt.value = ''
    showCreateTodo.value = false
    activeTab.value = 'open'
    showNotice('待办已创建')
    await refresh(false)
    await nextTick()
    todoListHeading.value?.focus({ preventScroll: true })
  } catch (exception) {
    createTodoError.value = toAppError(exception, '待办创建失败，请稍后重试。').message
  }
}

async function openTodoCreator() {
  createTodoTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  createTodoError.value = ''
  showCreateTodo.value = true
  await nextTick()
  await nextTick()
  newTodoInput.value?.focus()
}

async function setTodoCreatorOpen(open: boolean) {
  if (isCreatingTodo() || open === showCreateTodo.value) return
  if (open) { await openTodoCreator(); return }
  showCreateTodo.value = false
  await nextTick()
  await nextTick()
  if (createTodoTrigger?.isConnected) createTodoTrigger.focus()
}

async function setTodoStatus(id: number, status: string) {
  await runTodoAction(
    id,
    async () => updateAgentTodoStatus(id, status),
    status === 'done' ? '待办已完成' : status === 'cancelled' ? '待办已取消' : '待办已重新打开',
    status === 'done' ? 'task_complete' : undefined
  )
}

async function saveTodoDueAt(item: AgentTodoItem) {
  const hasEdit = Object.prototype.hasOwnProperty.call(dueEdits.value, item.id)
  const value = dueEdits.value[item.id]
  const saved = await runTodoAction(
    item.id,
    async () => updateAgentTodoDueAt(item.id, hasEdit ? (value ? new Date(value).toISOString() : null) : item.dueAt ?? null),
    '截止时间已保存',
    'task_reschedule'
  )
  if (saved) delete dueEdits.value[item.id]
}

async function postponeTodoToTomorrow(item: AgentTodoItem) {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  const saved = await runTodoAction(
    item.id,
    async () => updateAgentTodoDueAt(item.id, next.toISOString()),
    '已顺延到明天 9 点',
    'task_reschedule'
  )
  if (saved) delete dueEdits.value[item.id]
}

async function removeTodo(id: number) {
  const removed = await runTodoAction(id, async () => deleteAgentTodo(id), '待办已删除')
  if (removed) pendingDeleteTodoId.value = null
}

async function runTodoAction(
  id: number,
  action: () => Promise<unknown>,
  successMessage: string,
  productAction?: 'task_complete' | 'task_reschedule'
) {
  return runEntityAction(
    `todo-${id}`,
    action,
    successMessage,
    '任务操作失败，请稍后重试。',
    productAction
      ? () => {
        void trackProductEvent({
          eventType: 'effective_progress_action',
          page: 'tasks',
          actionType: productAction,
          status: productAction === 'task_complete' ? 'completed' : 'pending'
        }).catch(() => undefined)
      }
      : undefined
  )
}

function isTodoBusy(id: number) {
  return isActionPending(`todo-${id}`)
}

async function setCalendarStatus(id: number, status: string) {
  await runEntityAction(
    `calendar-${id}`,
    () => updateAgentCalendarStatus(id, status),
    status === 'done' ? '日历事件已完成' : '日历事件已取消',
    '日历事件更新失败，请稍后重试。'
  )
}

async function removeCalendar(id: number) {
  const removed = await runEntityAction(
    `calendar-${id}`,
    () => deleteAgentCalendar(id),
    '日历事件已删除',
    '日历事件删除失败，请稍后重试。'
  )
  if (removed) pendingDeleteCalendarId.value = null
}

async function readReminder(id: number) {
  await runEntityAction(
    `reminder-${id}`,
    () => markAgentReminderRead(id),
    '提醒已标记已读',
    '提醒操作失败，请稍后重试。'
  )
}

async function runEntityAction(
  key: string,
  action: () => Promise<unknown>,
  successMessage: string,
  failureMessage: string,
  onSuccess?: () => void
) {
  try {
    const completed = await runAction(key, async () => {
      await action()
      return true
    })
    if (!completed) return false
    showNotice(successMessage)
    onSuccess?.()
    await refresh(false)
    return true
  } catch (exception) {
    showNotice(toAppError(exception, failureMessage).message)
    return false
  }
}

function isCalendarBusy(id: number) {
  return isActionPending(`calendar-${id}`)
}

function isReminderBusy(id: number) {
  return isActionPending(`reminder-${id}`)
}

function isCreatingTodo() {
  return isActionPending('todo-create')
}

function showNotice(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 2200)
}

function statusText(status: string) {
  if (status === 'done') return '已完成'
  if (status === 'cancelled') return '已取消'
  if (status === 'scheduled') return '已计划'
  return '进行中'
}

function isOverdue(item: AgentTodoItem) {
  return item.status === 'open' && Boolean(item.dueAt) && new Date(item.dueAt as string).getTime() < Date.now()
}

function isToday(value?: string | null) {
  if (!value) return false
  return isSameDate(value, new Date().toISOString())
}

function isUpcoming(item: AgentTodoItem) {
  if (item.status !== 'open' || !item.dueAt || isToday(item.dueAt) || isOverdue(item)) return false
  const dueAt = new Date(item.dueAt).getTime()
  const end = startOfDay(new Date())
  end.setDate(end.getDate() + 8)
  return dueAt < end.getTime()
}

function isSameDate(value?: string | null, compareValue?: string | null) {
  if (!value || !compareValue) return false
  const date = new Date(value)
  const compareDate = new Date(compareValue)
  return date.getFullYear() === compareDate.getFullYear() && date.getMonth() === compareDate.getMonth() && date.getDate() === compareDate.getDate()
}

function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfWeek(value: Date) {
  const date = startOfDay(value)
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + mondayOffset)
  return date
}

function todoTimeText(item: AgentTodoItem) {
  if (!item.dueAt) return '未设置截止时间'
  return formatTime(item.dueAt)
}

function reminderTimeText(value?: string | null) {
  if (!value) return ''
  return formatTime(value)
}

function calendarTimeText(value?: string | null) {
  if (!value) return '未设置时间'
  return formatTime(value)
}

function shortDateText(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function weekdayText(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
}

function selectedDateText() {
  const date = new Date(selectedDate.value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

function buildCalendarDays() {
  const windowStart = startOfDay(new Date(calendarWindowStart.value))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(windowStart)
    date.setDate(windowStart.getDate() + index)
    return calendarDayStats(date)
  })
}

function calendarDayStats(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  const dayValue = startOfDay(date).toISOString()
  return {
    value: dayValue,
    todoCount: openTodos.value.filter((item) => isSameDate(item.dueAt, dayValue)).length,
    eventCount: upcomingEvents.value.filter((item) => isSameDate(item.startsAt, dayValue)).length,
    reminderCount: reminders.value.filter((item) => isSameDate(item.createdAt, dayValue)).length
  }
}

function weekRangeText() {
  const start = startOfDay(new Date(calendarWindowStart.value))
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return `${shortDateText(start.toISOString())} - ${shortDateText(end.toISOString())}`
}

function isCurrentDay(value: string) {
  return isSameDate(value, new Date().toISOString())
}

function dateOffset(days: number) {
  const date = startOfDay(new Date())
  date.setDate(date.getDate() + days)
  return date
}

function isInDateWindow(value?: string | null, startValue?: string | null, days = 7) {
  if (!value) return false
  const date = startOfDay(new Date(value))
  const start = startOfDay(startValue ? new Date(startValue) : new Date())
  const end = new Date(start)
  end.setDate(start.getDate() + days - 1)
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime()
}

function syncCalendarWindow(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  calendarWindowStart.value = startOfWeek(date).toISOString()
}

function selectCalendarDate(value: Date | string) {
  calendarScope.value = 'day'
  selectedDate.value = typeof value === 'string' ? startOfDay(new Date(value)).toISOString() : startOfDay(value).toISOString()
  syncCalendarWindow(selectedDate.value)
}

function selectTodayTimeline() {
  selectCalendarDate(new Date())
}

function selectTomorrowTimeline() {
  selectCalendarDate(dateOffset(1))
}

function showWeekDueTodos() {
  const today = new Date()
  selectedDate.value = startOfDay(today).toISOString()
  calendarWindowStart.value = startOfWeek(today).toISOString()
  calendarScope.value = 'week'
  activeTab.value = 'open'
}

function shiftCalendarWeek(offset: number) {
  const start = startOfDay(new Date(calendarWindowStart.value))
  start.setDate(start.getDate() + offset * 7)
  calendarWindowStart.value = start.toISOString()
  selectedDate.value = start.toISOString()
  calendarScope.value = 'day'
}

function resetCalendarWeek() {
  selectCalendarDate(new Date())
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function sortTodos(items: AgentTodoItem[]) {
  return [...items].sort((a, b) => todoPriority(b) - todoPriority(a) || dueTime(a) - dueTime(b) || b.id - a.id)
}

function todoPriority(item: AgentTodoItem) {
  if (isOverdue(item)) return 4
  if (item.status === 'open' && isToday(item.dueAt)) return 3
  if (item.status === 'open' && item.dueAt) return 2
  if (item.status === 'open') return 1
  return 0
}

function dueTime(item: AgentTodoItem) {
  if (!item.dueAt) return Number.MAX_SAFE_INTEGER
  const time = new Date(item.dueAt).getTime()
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time
}

function dedupeTodos(items: AgentTodoItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${normalizeTodoTitle(item.title)}:${item.status}:${item.dueAt || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeTodoTitle(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/^创建待办[:：]/, '').toLowerCase()
}

function tabCount(tab: typeof activeTab.value) {
  if (tab === 'open') return openTodos.value.length
  if (tab === 'today') return todayTodos.value.length
  if (tab === 'upcoming') return upcomingTodos.value.length
  if (tab === 'overdue') return overdueTodos.value.length
  if (tab === 'done') return todos.value.filter((item) => item.status === 'done').length
  if (tab === 'cancelled') return todos.value.filter((item) => item.status === 'cancelled').length
  return todos.value.length
}

function goalLinkText(item: AgentTodoItem) {
  const goals = (item.goalLinks || [])
    .filter((goal) => goal.schemaPath?.startsWith('goals.'))
    .map((goal) => cleanGoalLinkValue(String(goal.value || '')))
    .filter(Boolean)
  return Array.from(new Set(goals)).join('、')
}

function cleanGoalLinkValue(value: string) {
  return value
    .replace(/^用户当前目标包括/, '')
    .replace(/^当前目标包括/, '')
    .replace(/[。.]$/, '')
    .trim()
}

function todoDueInputValue(item: AgentTodoItem) {
  if (dueEdits.value[item.id] !== undefined) return dueEdits.value[item.id]
  if (!item.dueAt) return ''
  const date = new Date(item.dueAt)
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function setTodoDueEdit(item: AgentTodoItem, event: Event) {
  dueEdits.value[item.id] = (event.target as HTMLInputElement).value
}
</script>

<template>
  <section class="tasks-page" :class="{ 'tasks-page--empty': isEmpty }" :aria-busy="loading">
    <header class="tasks-header" :class="{ 'tasks-header--empty': isEmpty }">
      <div :class="{ 'sr-only': isEmpty }">
        <h1>待办与日程</h1>
        <p>整理待办，安排时间，让每一步都有进展。</p>
      </div>
      <div class="header-actions">
        <AppButton variant="ghost" :disabled="loading" :loading="loading" @click="refresh()"><RefreshCw v-if="!loading" :size="16" aria-hidden="true" />刷新</AppButton>
        <AppButton v-if="!isEmpty" @click="openTodoCreator"><Plus :size="17" aria-hidden="true" />新建待办</AppButton>
      </div>
    </header>
    <p v-if="notice" class="task-notice" role="status" aria-live="polite">{{ notice }}</p>

    <LoadingState v-if="loading && (!hasLoaded || !hasAnyData)" label="正在加载任务、日历和提醒" :cards="3" />
    <ErrorState
      v-else-if="allSourcesFailed"
      title="任务加载失败"
      :message="allFailureMessage"
      :retrying="loading"
      @retry="refresh()"
    />
    <template v-else-if="hasLoaded">
      <section v-if="isEmpty" class="tasks-welcome" aria-labelledby="tasks-welcome-title">
        <span class="welcome-icon"><ClipboardList :size="38" :stroke-width="1.6" aria-hidden="true" /></span>
        <h2 id="tasks-welcome-title">从一件小事，开始推进</h2>
        <p>把待办记下来，或让 Lyle 帮你整理。</p>
        <div class="welcome-actions">
          <AppButton class="welcome-primary" @click="openTodoCreator"><Plus :size="19" aria-hidden="true" />新建待办</AppButton>
          <RouterLink class="text-action" to="/"><MessageSquare :size="18" aria-hidden="true" />让 Lyle 帮我梳理</RouterLink>
        </div>
      </section>
      <section v-if="isEmpty" class="task-capabilities" aria-label="任务可以帮你做什么">
        <article>
          <span class="capability-icon"><ClipboardList :size="23" aria-hidden="true" /></span>
          <div><h3>待办清单</h3><p>记录事项与截止时间，随时更新进度。</p></div>
        </article>
        <article>
          <span class="capability-icon"><CalendarDays :size="23" aria-hidden="true" /></span>
          <div><h3>日历安排</h3><p>按日期查看待办和聊天创建的日历事件。</p></div>
        </article>
        <article>
          <span class="capability-icon"><Bell :size="23" aria-hidden="true" /></span>
          <div><h3>到期提醒</h3><p>集中查看待办、日历与跟进产生的提醒。</p></div>
        </article>
      </section>

      <template v-else>
        <section v-if="partialSourcesFailed" class="task-partial-warning" role="status">
          <div><strong>部分任务信息未能加载</strong><p>{{ failedSourceLabel }}暂时不可用；其余已加载内容仍可继续处理。</p></div>
          <AppButton variant="secondary" :disabled="loading" @click="refresh()">重试加载</AppButton>
        </section>
        <dl class="task-summary" aria-label="任务状态摘要">
          <div><dt>进行中</dt><dd>{{ sourceErrors.todos ? '—' : openTodos.length }}</dd></div>
          <div><dt>今日到期</dt><dd>{{ sourceErrors.todos ? '—' : todayTodos.length }}</dd></div>
          <div><dt>已逾期</dt><dd :class="{ 'count-danger': !sourceErrors.todos && overdueTodos.length > 0 }">{{ sourceErrors.todos ? '—' : overdueTodos.length }}</dd></div>
          <div><dt>未读提醒</dt><dd>{{ sourceErrors.reminders ? '—' : unreadReminders.length }}</dd></div>
        </dl>

        <article class="task-panel todo-panel" aria-labelledby="todo-list-heading">
          <div class="todo-panel-heading"><h2 id="todo-list-heading" ref="todoListHeading" tabindex="-1">我的待办</h2><span v-if="!sourceErrors.todos" class="panel-count">{{ todos.length }} 项</span></div>
          <div v-if="!sourceErrors.todos" class="todo-filter-tabs" role="group" aria-label="待办状态筛选">
            <button v-for="filter in todoFilters" :key="filter.value" :class="{ active: activeTab === filter.value }" :aria-pressed="activeTab === filter.value" type="button" @click="activeTab = filter.value">{{ filter.label }} <span>{{ tabCount(filter.value) }}</span></button>
          </div>
          <ErrorState v-if="sourceErrors.todos" title="待办加载失败" :message="sourceErrors.todos" :retrying="loading" @retry="refresh()" />
          <template v-else>
            <p v-if="duplicateTodoCount > 0" class="duplicate-note">已合并展示 {{ duplicateTodoCount }} 个标题、状态和截止时间相同的待办。</p>
            <section v-if="visibleTodos.length === 0" class="todo-empty" role="status">
              <CheckCheck v-if="activeTab === 'open' && todos.length && todos.every(item => item.status === 'done')" :size="30" aria-hidden="true" />
              <ClipboardList v-else :size="30" aria-hidden="true" />
              <h3>{{ todoEmptyState.title }}</h3>
              <p>{{ todoEmptyState.description }}</p>
              <button v-if="todoEmptyState.target" class="text-action" type="button" @click="activeTab = todoEmptyState.target || 'all'">{{ todoEmptyState.target === 'done' ? '查看已完成' : '查看全部待办' }}</button>
              <button v-else class="text-action" type="button" @click="openTodoCreator">新建待办</button>
            </section>
            <div v-else class="todo-list">
          <div v-for="item in visibleTodos" :key="item.id" class="task-row" :class="{ disabled: item.status !== 'open', danger: isOverdue(item), pending: isToday(item.dueAt) }">
          <div class="task-copy">
            <strong>
              {{ item.title }}
              <span v-if="isOverdue(item)" class="badge danger">逾期</span>
              <span v-else-if="item.status === 'open' && isToday(item.dueAt)" class="badge pending">今日</span>
            </strong>
            <span>{{ statusText(item.status) }} · {{ todoTimeText(item) }}</span>
            <small v-if="formatSourceReference(item.sourceRef)" class="memory-meta">来源：{{ formatSourceReference(item.sourceRef) }}</small>
            <small v-if="goalLinkText(item)" class="memory-meta">关联目标：{{ goalLinkText(item) }}</small>
          </div>
          <div class="task-row-controls">
            <span class="row task-status-actions">
              <button v-if="item.status !== 'done'" class="inline" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'done')">完成</button>
              <button v-if="item.status !== 'open'" class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'open')">重新打开</button>
              <button v-if="item.status !== 'cancelled'" class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'cancelled')">取消</button>
              <button class="inline danger" type="button" :disabled="isTodoBusy(item.id)" @click="pendingDeleteTodoId = item.id">删除</button>
            </span>
            <details v-if="item.status === 'open'" class="task-time-editor">
              <summary>调整时间<ChevronDown :size="14" aria-hidden="true" /></summary>
              <div class="task-time-fields">
                <input
                  class="inline-input"
                  type="datetime-local"
                  :aria-label="`调整 ${item.title} 的截止时间`"
                  :value="todoDueInputValue(item)"
                  :disabled="isTodoBusy(item.id)"
                  @input="setTodoDueEdit(item, $event)"
                />
                <button class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="saveTodoDueAt(item)">保存时间</button>
                <button class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="postponeTodoToTomorrow(item)">明天 9 点</button>
              </div>
            </details>
          </div>
          <ConfirmActionDialog
            :open="pendingDeleteTodoId === item.id"
            title="删除待办"
            :description="`“${item.title}”将被永久删除，此操作无法撤销。`"
            confirm-label="确认删除"
            danger
            :busy="isTodoBusy(item.id)"
            @update:open="(open) => { if (!open) pendingDeleteTodoId = null }"
            @confirm="removeTodo(item.id)"
          />
          </div>
            </div>
          </template>
        </article>

        <section class="task-secondary" aria-label="日历与提醒">
          <details class="task-panel execution-calendar" :open="Boolean(sourceErrors.calendar || partialSourcesFailed || upcomingEvents.length || weekDueTodos.length)">
            <summary><span class="secondary-icon"><CalendarDays :size="20" aria-hidden="true" /></span><span class="secondary-heading"><strong>执行日历</strong><small>按日期查看待办、事件和提醒</small></span><span class="panel-count">{{ sourceErrors.calendar ? '加载失败' : `${upcomingEvents.length} 个事件` }}</span><ChevronDown :size="17" class="disclosure-chevron" aria-hidden="true" /></summary>
            <div class="secondary-content">
        <ErrorState
          v-if="sourceErrors.calendar"
          title="日历加载失败"
          :message="sourceErrors.calendar"
          :retrying="loading"
          @retry="refresh()"
        />
        <template v-else>
        <p v-if="sourceErrors.todos || sourceErrors.reminders" class="task-source-note" role="status">
          日历当前仅展示成功加载的数据；{{ [sourceErrors.todos ? '待办' : '', sourceErrors.reminders ? '提醒' : ''].filter(Boolean).join('、') }}暂时不可用。
        </p>
        <div class="calendar-quick-actions">
          <button class="secondary" type="button" @click="selectTodayTimeline">
            今日时间线
            <small>{{ todayTodos.length + todayCalendarDay.eventCount + todayCalendarDay.reminderCount }} 项</small>
          </button>
          <button class="secondary" type="button" @click="selectTomorrowTimeline">
            明日安排
            <small>{{ tomorrowTodos.length + tomorrowCalendarDay.eventCount + tomorrowCalendarDay.reminderCount }} 项</small>
          </button>
          <button class="secondary" type="button" @click="showWeekDueTodos">
            本周到期
            <small>{{ weekDueTodos.length }} 个待办</small>
          </button>
        </div>

        <div class="calendar-legend">
          <span>待办截止</span>
          <span>日历事件</span>
          <span>提醒记录</span>
        </div>

        <div class="calendar-week-nav">
          <button class="secondary" type="button" @click="shiftCalendarWeek(-1)">上一周</button>
          <strong>{{ weekRangeText() }}</strong>
          <span class="row">
            <button class="secondary" type="button" @click="resetCalendarWeek">回到本周</button>
            <button class="secondary" type="button" @click="shiftCalendarWeek(1)">下一周</button>
          </span>
        </div>

        <div class="calendar-strip">
          <button
            v-for="day in calendarDays"
            :key="day.value"
            class="calendar-day"
            :class="{ active: isSameDate(day.value, selectedDate), today: isCurrentDay(day.value) }"
            type="button"
            :aria-pressed="isSameDate(day.value, selectedDate)"
            @click="selectCalendarDate(day.value)"
          >
            <span>周{{ weekdayText(day.value) }}</span>
            <strong>{{ shortDateText(day.value) }}</strong>
            <small>{{ day.todoCount + day.eventCount + day.reminderCount }} 项</small>
          </button>
        </div>

        <div class="calendar-day-detail">
          <div class="section-title">
            <strong>{{ calendarScope === 'week' ? '本周到期' : selectedDateText() }}</strong>
            <small v-if="calendarScope === 'day'" class="memory-meta">待办 {{ selectedDayTodos.length }} · 事件 {{ selectedDayEvents.length }} · 提醒 {{ selectedDayReminders.length }}</small>
            <small v-else class="memory-meta">待办 {{ weekDueTodos.length }}</small>
          </div>

          <section v-if="calendarScope === 'week' && weekDueTodos.length" class="stack">
            <small class="memory-meta">本周到期待办</small>
            <div v-for="item in weekDueTodos" :key="`week-todo-${item.id}`" class="calendar-agenda-item" :class="{ danger: isOverdue(item), pending: isToday(item.dueAt) }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ todoTimeText(item) }}</span>
                <small v-if="goalLinkText(item)" class="memory-meta">关联目标：{{ goalLinkText(item) }}</small>
              </div>
              <button class="inline" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'done')">
                {{ isTodoBusy(item.id) ? '处理中…' : '完成' }}
              </button>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && selectedDayTodos.length" class="stack">
            <small class="memory-meta">待办截止</small>
            <div v-for="item in selectedDayTodos" :key="`todo-${item.id}`" class="calendar-agenda-item" :class="{ danger: isOverdue(item), pending: isToday(item.dueAt) }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ todoTimeText(item) }}</span>
              </div>
              <button class="inline" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'done')">
                {{ isTodoBusy(item.id) ? '处理中…' : '完成' }}
              </button>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && selectedDayEvents.length" class="stack">
            <small class="memory-meta">日历事件</small>
            <div v-for="item in selectedDayEvents" :key="`event-${item.id}`" class="calendar-agenda-item">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ statusText(item.status) }} · {{ calendarTimeText(item.startsAt) }}</span>
                <small v-if="formatSourceReference(item.sourceRef)" class="memory-meta">来源：{{ formatSourceReference(item.sourceRef) }}</small>
              </div>
              <span class="row">
                <button class="inline" type="button" :disabled="isCalendarBusy(item.id)" @click="setCalendarStatus(item.id, 'done')">
                  {{ isCalendarBusy(item.id) ? '处理中…' : '完成' }}
                </button>
                <button class="inline secondary" type="button" :disabled="isCalendarBusy(item.id)" @click="setCalendarStatus(item.id, 'cancelled')">取消</button>
                <button class="inline danger" type="button" :disabled="isCalendarBusy(item.id)" @click="pendingDeleteCalendarId = item.id">删除</button>
              </span>
              <ConfirmActionDialog
                :open="pendingDeleteCalendarId === item.id"
                title="删除日历事件"
                :description="`“${item.title}”将被永久删除，此操作无法撤销。`"
                confirm-label="确认删除"
                danger
                :busy="isCalendarBusy(item.id)"
                @update:open="(open) => { if (!open) pendingDeleteCalendarId = null }"
                @confirm="removeCalendar(item.id)"
              />
            </div>
          </section>

          <section v-if="calendarScope === 'day' && selectedDayReminders.length" class="stack">
            <small class="memory-meta">提醒记录</small>
            <div v-for="item in selectedDayReminders" :key="`reminder-${item.id}`" class="calendar-agenda-item" :class="{ disabled: item.status === 'read' }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.message }} · {{ reminderTimeText(item.createdAt) }}</span>
              </div>
              <button v-if="item.status !== 'read'" class="inline" type="button" :disabled="isReminderBusy(item.id)" @click="readReminder(item.id)">
                {{ isReminderBusy(item.id) ? '处理中…' : '已读' }}
              </button>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && weekDueTodos.length" class="stack">
            <small class="memory-meta">本周到期</small>
            <div v-for="item in weekDueTodos.slice(0, 4)" :key="`week-preview-${item.id}`" class="calendar-agenda-item" :class="{ danger: isOverdue(item), pending: isToday(item.dueAt) }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ todoTimeText(item) }}</span>
              </div>
              <button class="inline" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'done')">
                {{ isTodoBusy(item.id) ? '处理中…' : '完成' }}
              </button>
            </div>
          </section>

          <div v-if="calendarTotal === 0 && weekDueTodos.length === 0" class="empty-state compact">
            <strong>{{ calendarScope === 'week' ? '本周暂无到期待办' : '当天暂无安排' }}</strong>
            <span>可以在聊天里说“创建日历：明天 10 点开会”，或给待办设置截止时间。</span>
          </div>
        </div>
        </template>
            </div>
          </details>
          <details class="task-panel reminders-panel" :open="Boolean(reminders.length || partialSourcesFailed)">
            <summary><span class="secondary-icon"><Bell :size="20" aria-hidden="true" /></span><span class="secondary-heading"><strong>提醒</strong><small>待办、日历与 Agent 的跟进</small></span><span class="panel-count">{{ sourceErrors.reminders ? '加载失败' : `${unreadReminders.length} 未读` }}</span><ChevronDown :size="17" class="disclosure-chevron" aria-hidden="true" /></summary>
            <div class="secondary-content">
      <ErrorState
        v-if="sourceErrors.reminders"
        title="提醒加载失败"
        :message="sourceErrors.reminders"
        :retrying="loading"
        @retry="refresh()"
      />
      <template v-else>
        <p v-if="reminders.length === 0" class="muted">暂无提醒。</p>
        <div
          v-for="item in reminders"
          :key="item.id"
          class="memory-row stacked"
          :class="{ disabled: item.status === 'read' }"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.message }} · {{ reminderTimeText(item.createdAt) }}</span>
          <span class="row">
            <button
              v-if="item.status !== 'read'"
              class="inline"
              type="button"
              :disabled="isReminderBusy(item.id)"
              @click="readReminder(item.id)"
            >
              {{ isReminderBusy(item.id) ? '处理中…' : '标记已读' }}
            </button>
            <small v-else class="memory-meta">已读</small>
          </span>
        </div>
      </template>
            </div>
          </details>
        </section>
      </template>
    </template>

    <DetailDrawer :open="showCreateTodo" title="新建待办" description="先记下要做的事，时间可以稍后再安排。" @update:open="setTodoCreatorOpen">
      <form id="manual-todo-form" class="manual-todo-form" @submit.prevent="createTodoManually">
        <p v-if="createTodoError" class="create-todo-error" role="alert">{{ createTodoError }}</p>
        <label for="manual-todo-title">待办标题</label>
        <input id="manual-todo-title" ref="newTodoInput" v-model="newTodoTitle" data-testid="manual-todo-title" placeholder="例如：整理本周的项目进展" autofocus :disabled="isCreatingTodo()" />
        <label for="manual-todo-due-at">截止时间 <span>选填</span></label>
        <input id="manual-todo-due-at" v-model="newTodoDueAt" data-testid="manual-todo-due-at" type="datetime-local" :disabled="isCreatingTodo()" aria-describedby="todo-due-hint" />
        <p id="todo-due-hint" class="form-hint">设置时间后，可以在执行日历中一起查看。</p>
      </form>
      <template #footer>
        <AppButton variant="secondary" :disabled="isCreatingTodo()" @click="setTodoCreatorOpen(false)">取消</AppButton>
        <AppButton form="manual-todo-form" data-testid="manual-todo-submit" type="submit" :loading="isCreatingTodo()" :disabled="!newTodoTitle.trim()">{{ isCreatingTodo() ? '创建中…' : '创建待办' }}</AppButton>
      </template>
    </DetailDrawer>
  </section>
</template>

<style scoped>
.tasks-page { --task-page-padding: var(--lyle-space-6); display: grid; box-sizing: border-box; gap: 24px; width: 100%; max-width: calc(1180px + var(--task-page-padding) + var(--task-page-padding)); min-width: 0; margin: 0 auto; padding: var(--task-page-padding); }
.tasks-page--empty { gap: 0; }
.tasks-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.tasks-header--empty { min-height: 40px; justify-content: flex-end; }
.tasks-header h1 { margin: 0; font-size: 32px; line-height: 1.3; letter-spacing: -.025em; }
.tasks-header p { margin: 8px 0 0; color: var(--muted-foreground); line-height: 1.6; }
.header-actions { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.tasks-welcome { display: flex; flex-direction: column; align-items: center; padding: 52px 24px 58px; text-align: center; }
.welcome-icon { display: grid; place-items: center; width: 84px; height: 84px; margin-bottom: 26px; border-radius: 20px; background: var(--primary-soft, #eef2ff); color: var(--primary); }
.tasks-welcome h2 { margin: 0; color: var(--foreground); font-size: clamp(28px, 2.7vw, 40px); font-weight: 750; line-height: 1.4; letter-spacing: -.035em; }
.tasks-welcome > p { margin: 15px 0 0; color: var(--muted-foreground); font-size: 18px; line-height: 1.7; }
.welcome-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 26px; margin-top: 30px; }
.welcome-actions .welcome-primary { min-height: 52px; padding: 13px 23px; border-radius: 10px; font-size: 16px; }
.text-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; border: 0; border-radius: 4px; padding: 4px 0; background: transparent; color: var(--primary); font-size: 14px; font-weight: 600; text-decoration: none; box-shadow: none; }
.welcome-actions .text-action { font-size: 16px; }
.text-action:hover { background: transparent; color: var(--primary-hover); text-decoration: underline; text-underline-offset: 4px; }
.tasks-page button:focus-visible, .text-action:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.task-capabilities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; padding: 32px 0; border-top: 1px solid var(--border); }
.task-capabilities article { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
.capability-icon { display: grid; place-items: center; flex: 0 0 48px; height: 48px; border-radius: 12px; color: var(--primary); background: var(--primary-soft, #eef2ff); }
.task-capabilities h3 { margin: 2px 0 7px; font-size: 16px; line-height: 1.5; }
.task-capabilities p { max-width: 240px; margin: 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.task-notice { margin: 0; padding: 12px 16px; border: 1px solid var(--success-border); border-radius: 10px; background: var(--success-soft); color: var(--success-strong); font-size: 14px; line-height: 1.6; }
.task-partial-warning { display: flex; align-items: center; justify-content: space-between; gap: 20px; border: 1px solid var(--warning-border); border-radius: 12px; background: var(--warning-soft); padding: 16px 20px; color: var(--warning-strong); }
.task-partial-warning p { margin: 5px 0 0; color: var(--foreground); font-size: 14px; line-height: 1.6; }
.task-partial-warning button { flex: 0 0 auto; }
.task-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 36px; margin: 0; padding: 2px 0; }
.task-summary > div { display: flex; align-items: baseline; gap: 10px; }
.task-summary dt { color: var(--muted-foreground); font-size: 13px; }
.task-summary dd { margin: 0; color: var(--foreground); font-size: 20px; font-weight: 700; }
.task-summary .count-danger { color: var(--danger-strong); }
.task-panel { min-width: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.todo-panel { padding: 22px 24px 8px; }
.todo-panel-heading { display: flex; align-items: center; gap: 12px; }
.todo-panel-heading h2 { margin: 0; color: var(--foreground); font-size: 19px; line-height: 1.5; }
.todo-panel-heading h2:focus { outline: none; }
.panel-count { color: var(--muted-foreground); font-size: 12px; white-space: nowrap; }
.todo-filter-tabs { display: flex; gap: 8px; width: 100%; max-width: 100%; min-width: 0; flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: thin; margin-top: 18px; border-bottom: 1px solid var(--border); padding: 0 0 10px; -webkit-overflow-scrolling: touch; }
.todo-filter-tabs button { flex: 0 0 auto; min-height: 34px; border: 0; border-radius: 7px; background: transparent; padding: 7px 10px; color: var(--muted-foreground); font-size: 13px; font-weight: 550; white-space: nowrap; box-shadow: none; }
.todo-filter-tabs button span { margin-left: 5px; font-size: 12px; opacity: .75; }
.todo-filter-tabs button.active { background: var(--primary-soft, #eef2ff); color: var(--primary); font-weight: 650; }
.todo-filter-tabs button:hover { background: var(--surface-muted); color: var(--foreground); }
.todo-filter-tabs button.active:hover { background: var(--primary-soft, #eef2ff); color: var(--primary); }
.duplicate-note { margin: 14px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.7; }
.todo-list { display: grid; min-width: 0; }
.task-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-width: 0; gap: 16px 28px; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: transparent; padding: 18px 0; }
.task-row:first-child { border-top: 0; }
.task-row.pending, .task-row.danger { border-color: var(--border); background: transparent; }
.task-copy { display: grid; min-width: 0; gap: 5px; }
.task-copy > strong { color: var(--foreground); font-size: 15px; font-weight: 650; line-height: 1.65; overflow-wrap: anywhere; }
.task-copy > span, .task-row .memory-meta { color: var(--muted-foreground); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.task-copy > strong .badge { margin-left: 6px; padding: 2px 7px; font-size: 11px; }
.task-row-controls { display: grid; justify-items: end; min-width: 0; gap: 7px; }
.task-row .row { display: flex; min-width: 0; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
.task-time-editor { min-width: 0; max-width: 100%; }
.task-time-editor[open] { width: 290px; }
.task-time-editor summary { display: flex; align-items: center; justify-content: flex-end; gap: 5px; min-height: 26px; width: fit-content; margin-left: auto; border-radius: 4px; color: var(--muted-foreground); font-size: 12px; list-style: none; cursor: pointer; }
.task-time-editor summary::-webkit-details-marker { display: none; }
.task-time-editor summary:hover { color: var(--primary); }
.task-time-editor[open] summary svg { transform: rotate(180deg); }
.task-time-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-muted); }
.task-row .inline-input { grid-column: 1 / -1; width: 100%; min-width: 0; max-width: 100%; min-height: 34px; box-sizing: border-box; padding: 6px 9px; font-size: 12px; }
.task-row .inline, .calendar-agenda-item .inline { min-height: 32px; padding: 6px 10px; font-size: 12px; }
.task-row.disabled { opacity: .72; }
.todo-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 42px 16px; text-align: center; }
.todo-empty > svg { margin-bottom: 3px; color: var(--primary); opacity: .7; }
.todo-empty h3 { margin: 0; font-size: 17px; }
.todo-empty p { max-width: 420px; margin: 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.todo-empty .text-action { margin-top: 2px; }
.task-secondary { display: grid; min-width: 0; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.task-secondary summary { display: flex; min-width: 0; align-items: center; gap: 12px; padding: 19px 20px; list-style: none; cursor: pointer; }
.task-secondary summary::-webkit-details-marker { display: none; }
.secondary-icon { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 10px; color: var(--primary); background: var(--primary-soft, #eef2ff); }
.secondary-heading { display: grid; min-width: 0; gap: 4px; }
.secondary-heading strong { color: var(--foreground); font-size: 15px; }
.secondary-heading small { color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }
.task-secondary summary > .panel-count { margin-left: auto; }
.disclosure-chevron { flex-shrink: 0; color: var(--muted-foreground); transition: transform .15s; }
.task-secondary details[open] > summary .disclosure-chevron { transform: rotate(180deg); }
.secondary-content { min-width: 0; padding: 0 20px 20px; }
.secondary-content > .muted { margin: 0; font-size: 14px; }
.task-source-note { margin: 0; border: 1px solid var(--warning-border); border-radius: 8px; background: var(--warning-soft); padding: 10px 12px; color: var(--warning-strong); font-size: 12px; line-height: 1.65; }
.calendar-quick-actions { gap: 6px; margin-top: 0; }
.calendar-quick-actions button { min-width: 0; min-height: 52px; padding: 9px; border-color: var(--border); background: var(--surface-muted); font-size: 12px; }
.calendar-quick-actions small { font-size: 11px; }
.calendar-legend { margin-top: 14px; }
.calendar-legend span { border: 0; background: transparent; padding: 0 8px 0 0; color: var(--muted-foreground); font-size: 11px; font-weight: 450; }
.calendar-week-nav { min-width: 0; margin-top: 16px; gap: 6px; }
.calendar-week-nav strong { font-size: 13px; }
.calendar-week-nav .secondary { min-height: 32px; padding: 6px 8px; font-size: 12px; }
.calendar-week-nav .row { min-width: 0; gap: 6px; }
.calendar-strip { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.calendar-day { min-width: 0; min-height: 72px; border-color: var(--border); border-radius: 8px; background: transparent; padding: 7px 2px; }
.calendar-day span, .calendar-day small { font-size: 10px; }
.calendar-day strong { font-size: 13px; }
.calendar-day.active { border-color: var(--primary); background: var(--primary-soft, #eef2ff); }
.calendar-day.active strong { color: var(--primary); }
.calendar-day.today:not(.active) { border-color: var(--primary-border, #c7d2fe); }
.calendar-day-detail { gap: 14px; }
.calendar-day-detail .section-title { display: flex; flex-wrap: wrap; gap: 7px; }
.calendar-day-detail .section-title > strong { font-size: 14px; }
.calendar-day-detail .memory-meta { font-size: 11px; }
.calendar-agenda-item { min-width: 0; background: var(--surface); border-color: var(--border); }
.calendar-agenda-item > div { min-width: 0; }
.calendar-agenda-item strong { font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.calendar-agenda-item span { font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.calendar-agenda-item .row { flex-wrap: wrap; gap: 6px; }
.calendar-agenda-item.pending, .calendar-agenda-item.danger { background: transparent; border-color: var(--border); }
.calendar-day-detail .empty-state { padding: 24px 8px; border: 0; background: transparent; }
.calendar-day-detail .empty-state strong { font-size: 14px; }
.calendar-day-detail .empty-state span { font-size: 12px; }
.reminders-panel .memory-row { display: grid; gap: 8px; min-width: 0; margin: 0; border: 0; border-top: 1px solid var(--border); border-radius: 0; padding: 16px 0; background: transparent; }
.reminders-panel .memory-row:first-of-type { border-top: 0; }
.reminders-panel .memory-row strong { font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.reminders-panel .memory-row > span { color: var(--muted-foreground); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.reminders-panel .memory-row .inline { min-height: 32px; padding: 6px 10px; font-size: 12px; }
.manual-todo-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin: 0; }
.manual-todo-form > label { margin-top: 10px; color: var(--foreground); font-size: 14px; font-weight: 650; }
.manual-todo-form > label span { margin-left: 5px; color: var(--muted-foreground); font-size: 12px; font-weight: 400; }
.manual-todo-form input { width: 100%; min-width: 0; max-width: 100%; min-height: 44px; box-sizing: border-box; }
.form-hint { margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.7; }
.create-todo-error { margin: 0; padding: 12px; border-radius: 8px; background: var(--danger-soft); color: var(--danger-strong); font-size: 14px; line-height: 1.6; }
@media (max-width: 1000px) {
  .task-secondary { grid-template-columns: minmax(0, 1fr); }
  .task-capabilities { gap: 18px; }
  .task-capabilities article { gap: 12px; }
}
@media (max-width: 959px) {
  .tasks-page { --task-page-padding: var(--lyle-space-4); }
}
@media (max-width: 639px) {
  .tasks-page { --task-page-padding: var(--lyle-space-3); }
}
@media (max-width: 680px) {
  .tasks-page { gap: 18px; }
  .tasks-page--empty { gap: 0; }
  .tasks-header { align-items: flex-start; gap: 12px; }
  .tasks-header h1 { font-size: 26px; }
  .tasks-header p { display: none; }
  .header-actions { gap: 4px; }
  .header-actions :deep(.app-button) { padding: 8px 10px; font-size: 13px; }
  .tasks-welcome { padding: 30px 4px 36px; }
  .welcome-icon { width: 64px; height: 64px; border-radius: 18px; margin-bottom: 20px; }
  .welcome-icon > svg { width: 31px; height: 31px; }
  .tasks-welcome h2 { max-width: 310px; font-size: 27px; }
  .tasks-welcome > p { max-width: 285px; font-size: 15px; margin-top: 12px; }
  .welcome-actions { gap: 14px; margin-top: 24px; }
  .welcome-actions .welcome-primary { min-height: 46px; padding: 11px 16px; font-size: 14px; }
  .welcome-actions .text-action { font-size: 14px; }
  .task-capabilities { grid-template-columns: minmax(0, 1fr); gap: 22px; padding-top: 26px; }
  .task-capabilities article { gap: 15px; }
  .task-capabilities h3 { margin-bottom: 4px; font-size: 15px; }
  .task-capabilities p { max-width: 100%; font-size: 13px; }
  .capability-icon { flex-basis: 42px; height: 42px; border-radius: 11px; }
  .task-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; }
  .task-summary > div { gap: 8px; }
  .task-summary dt { font-size: 12px; }
  .task-summary dd { font-size: 18px; }
  .todo-panel { padding: 18px 16px 4px; }
  .task-row { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 18px 0; }
  .task-row-controls { width: 100%; justify-items: start; gap: 8px; }
  .task-time-editor[open] { width: 100%; }
  .task-time-editor summary { margin-left: 0; justify-content: flex-start; }
  .todo-empty { padding: 32px 4px; }
  .todo-empty p { font-size: 13px; }
  .task-secondary summary { padding: 16px; gap: 10px; }
  .secondary-heading small { font-size: 11px; }
  .secondary-content { padding: 0 16px 16px; }
  .calendar-week-nav { grid-template-columns: auto minmax(0, 1fr); }
  .calendar-week-nav strong { grid-column: 1 / -1; grid-row: 1; }
  .calendar-week-nav > .row { justify-content: flex-end; }
  .calendar-agenda-item { grid-template-columns: minmax(0, 1fr); }
  .calendar-agenda-item > .inline { justify-self: start; }
  .task-partial-warning { flex-direction: column; align-items: stretch; gap: 12px; padding: 14px; }
  .task-partial-warning button { align-self: flex-start; }
}
</style>
