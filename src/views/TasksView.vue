<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const nextTodo = computed(() => sortTodos(openTodos.value)[0])
const unreadReminderPreview = computed(() => unreadReminders.value[0])
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
  try {
    const created = await runAction('todo-create', async () => {
      await createAgentTodo(title, newTodoDueAt.value ? new Date(newTodoDueAt.value).toISOString() : null)
      return true
    })
    if (!created) return
    newTodoTitle.value = ''
    newTodoDueAt.value = ''
    activeTab.value = 'open'
    showNotice('待办已创建')
    await refresh(false)
  } catch (exception) {
    showNotice(toAppError(exception, '待办创建失败，请稍后重试。').message)
  }
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
  const value = dueEdits.value[item.id]
  await runTodoAction(
    item.id,
    async () => updateAgentTodoDueAt(item.id, value ? new Date(value).toISOString() : null),
    '截止时间已保存',
    'task_reschedule'
  )
}

async function postponeTodoToTomorrow(item: AgentTodoItem) {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  await runTodoAction(
    item.id,
    async () => updateAgentTodoDueAt(item.id, next.toISOString()),
    '已顺延到明天 9 点',
    'task_reschedule'
  )
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
  <section class="page" :aria-busy="loading">
    <div class="toolbar">
      <div>
        <h1>任务</h1>
        <p class="muted">查看智能体创建的待办、日历事件和到期提醒，持续追踪可靠执行状态。</p>
      </div>
      <button :disabled="loading" type="button" @click="refresh()">刷新</button>
    </div>
    <p v-if="notice" class="toast" role="status" aria-live="polite">{{ notice }}</p>

    <LoadingState v-if="loading && !hasLoaded" label="正在加载任务、日历和提醒" :cards="3" />
    <ErrorState
      v-else-if="allSourcesFailed"
      title="任务加载失败"
      :message="allFailureMessage"
      :retrying="loading"
      @retry="refresh()"
    />

    <template v-else-if="hasLoaded">
      <section v-if="partialSourcesFailed" class="task-partial-warning" role="status">
        <div>
          <strong>部分任务信息未能加载</strong>
          <p>{{ failedSourceLabel }}暂时不可用；其余已加载内容仍可继续处理。</p>
        </div>
        <button type="button" :disabled="loading" @click="refresh()">重试加载</button>
      </section>

    <article v-if="nextTodo || unreadReminderPreview || duplicateTodoCount > 0" class="item task-command-center">
      <div class="section-title">
        <div>
          <h2>执行焦点</h2>
          <p class="muted">优先展示当前最应该处理的任务、提醒和重复项。</p>
        </div>
        <span class="badge" :class="{ danger: overdueTodos.length > 0, pending: todayTodos.length > 0 && overdueTodos.length === 0, success: overdueTodos.length === 0 && todayTodos.length === 0 }">
          {{ overdueTodos.length > 0 ? `${overdueTodos.length} 个逾期` : todayTodos.length > 0 ? `${todayTodos.length} 个今日` : '状态稳定' }}
        </span>
      </div>
      <div class="task-focus-grid">
        <section v-if="nextTodo" class="task-focus-card" :class="{ danger: isOverdue(nextTodo), pending: isToday(nextTodo.dueAt) }">
          <small class="memory-meta">优先待办</small>
          <strong>{{ nextTodo.title }}</strong>
          <span>{{ statusText(nextTodo.status) }} · {{ todoTimeText(nextTodo) }}</span>
          <small v-if="goalLinkText(nextTodo)" class="memory-meta">关联目标：{{ goalLinkText(nextTodo) }}</small>
          <span class="row">
            <button class="inline secondary" type="button" :disabled="isTodoBusy(nextTodo.id)" @click="postponeTodoToTomorrow(nextTodo)">明天 9 点</button>
            <button class="inline" type="button" :disabled="isTodoBusy(nextTodo.id)" @click="setTodoStatus(nextTodo.id, 'done')">
              {{ isTodoBusy(nextTodo.id) ? '处理中…' : '完成' }}
            </button>
          </span>
        </section>
        <section v-if="unreadReminderPreview" class="task-focus-card pending">
          <small class="memory-meta">未读提醒</small>
          <strong>{{ unreadReminderPreview.title }}</strong>
          <span>{{ unreadReminderPreview.message }}</span>
          <button class="inline" type="button" :disabled="isReminderBusy(unreadReminderPreview.id)" @click="readReminder(unreadReminderPreview.id)">
            {{ isReminderBusy(unreadReminderPreview.id) ? '处理中…' : '标记已读' }}
          </button>
        </section>
        <section v-if="duplicateTodoCount > 0" class="task-focus-card pending">
          <small class="memory-meta">重复提醒</small>
          <strong>已隐藏 {{ duplicateTodoCount }} 个重复待办</strong>
          <span>列表按标题、状态和截止时间去重展示，避免测试数据干扰执行判断。</span>
        </section>
      </div>
    </article>

    <div class="status-grid" aria-label="任务状态摘要">
      <div>
        <span class="metric">{{ sourceErrors.todos ? '—' : openTodos.length }}</span>
        <span class="muted">进行中待办</span>
      </div>
      <div>
        <span class="metric">{{ sourceErrors.todos ? '—' : todayTodos.length }}</span>
        <span class="muted">今日到期</span>
      </div>
      <div>
        <span class="metric">{{ sourceErrors.todos ? '—' : overdueTodos.length }}</span>
        <span class="muted">已逾期</span>
      </div>
      <div>
        <span class="metric">{{ sourceErrors.reminders ? '—' : unreadReminders.length }}</span>
        <span class="muted">未读提醒</span>
      </div>
    </div>

    <article class="item collapsible-section">
      <div class="section-title">
        <div>
          <h2>提醒</h2>
          <p class="muted">展示由待办、日历和 Agent 跟进产生的提醒。</p>
        </div>
        <span class="badge">{{ sourceErrors.reminders ? '—' : unreadReminders.length }} 未读</span>
      </div>
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
    </article>

    <div class="grid">
      <article class="item todo-panel">
        <div class="section-title">
          <h2>待办</h2>
          <div v-if="!sourceErrors.todos" class="segmented todo-filter-tabs" aria-label="待办状态筛选">
            <button :class="{ active: activeTab === 'open' }" type="button" @click="activeTab = 'open'">进行中 {{ tabCount('open') }}</button>
            <button :class="{ active: activeTab === 'today' }" type="button" @click="activeTab = 'today'">今日 {{ tabCount('today') }}</button>
            <button :class="{ active: activeTab === 'upcoming' }" type="button" @click="activeTab = 'upcoming'">即将到期 {{ tabCount('upcoming') }}</button>
            <button :class="{ active: activeTab === 'overdue' }" type="button" @click="activeTab = 'overdue'">逾期 {{ tabCount('overdue') }}</button>
            <button :class="{ active: activeTab === 'done' }" type="button" @click="activeTab = 'done'">已完成 {{ tabCount('done') }}</button>
            <button :class="{ active: activeTab === 'cancelled' }" type="button" @click="activeTab = 'cancelled'">已取消 {{ tabCount('cancelled') }}</button>
            <button :class="{ active: activeTab === 'all' }" type="button" @click="activeTab = 'all'">全部 {{ tabCount('all') }}</button>
          </div>
        </div>
        <ErrorState
          v-if="sourceErrors.todos"
          title="待办加载失败"
          :message="sourceErrors.todos"
          :retrying="loading"
          @retry="refresh()"
        />
        <template v-else>
          <form class="manual-todo-form" @submit.prevent="createTodoManually">
            <input v-model="newTodoTitle" data-testid="manual-todo-title" placeholder="输入待办标题" aria-label="待办标题" :disabled="isCreatingTodo()" />
            <input v-model="newTodoDueAt" data-testid="manual-todo-due-at" type="datetime-local" aria-label="截止时间" :disabled="isCreatingTodo()" />
            <button data-testid="manual-todo-submit" type="submit" :disabled="isCreatingTodo() || !newTodoTitle.trim()">
              {{ isCreatingTodo() ? '创建中…' : '新建待办' }}
            </button>
          </form>
          <p v-if="visibleTodos.length === 0" class="muted">暂无待办。可以在这里直接新建，也可以通过聊天生成候选待办。</p>
          <div v-for="item in visibleTodos" :key="item.id" class="task-row" :class="{ disabled: item.status !== 'open', danger: isOverdue(item), pending: isToday(item.dueAt) }">
          <strong>
            {{ item.title }}
            <span v-if="isOverdue(item)" class="badge danger">逾期</span>
            <span v-else-if="isToday(item.dueAt)" class="badge pending">今日</span>
          </strong>
          <span>{{ statusText(item.status) }} · {{ todoTimeText(item) }}</span>
          <small v-if="formatSourceReference(item.sourceRef)" class="memory-meta">来源：{{ formatSourceReference(item.sourceRef) }}</small>
          <small v-if="goalLinkText(item)" class="memory-meta">
            关联目标：{{ goalLinkText(item) }}
          </small>
          <span v-if="item.status === 'open'" class="row">
            <input
              class="inline-input"
              type="datetime-local"
              :value="todoDueInputValue(item)"
              :disabled="isTodoBusy(item.id)"
              @input="setTodoDueEdit(item, $event)"
            />
            <button class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="saveTodoDueAt(item)">保存时间</button>
            <button class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="postponeTodoToTomorrow(item)">明天 9 点</button>
          </span>
          <span class="row">
            <button v-if="item.status !== 'done'" class="inline" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'done')">完成</button>
            <button v-if="item.status !== 'open'" class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'open')">重新打开</button>
            <button v-if="item.status !== 'cancelled'" class="inline secondary" type="button" :disabled="isTodoBusy(item.id)" @click="setTodoStatus(item.id, 'cancelled')">取消</button>
            <button class="inline danger" type="button" :disabled="isTodoBusy(item.id)" @click="pendingDeleteTodoId = item.id">删除</button>
          </span>
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
        </template>
      </article>

      <article class="item execution-calendar">
        <div class="section-title">
          <div>
            <h2>执行日历</h2>
            <p class="muted">点击日期查看当天待办、日历事件和提醒。</p>
          </div>
          <span class="badge">{{ sourceErrors.calendar ? '—' : calendarTotal }} 项</span>
        </div>

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
            @click="selectCalendarDate(day.value)"
          >
            <span>周{{ weekdayText(day.value) }}</span>
            <strong>{{ shortDateText(day.value) }}</strong>
            <small>{{ day.todoCount + day.eventCount + day.reminderCount }} 项</small>
          </button>
        </div>

        <div class="calendar-day-detail">
          <div class="section-title">
            <strong>{{ calendarScope === 'week' ? '未来 7 天到期' : selectedDateText() }}</strong>
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
            <strong>{{ calendarScope === 'week' ? '已加载的数据中，未来 7 天暂无到期待办' : '已加载的数据中，当天暂无安排' }}</strong>
            <span>可以在聊天里说“创建日历：明天 10 点开会”，或给待办设置截止时间。</span>
          </div>
        </div>
        </template>
      </article>
    </div>
    </template>
  </section>
</template>

<style scoped>
.task-partial-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-lg);
  background: var(--warning-soft);
  padding: var(--space-4);
  color: var(--warning-strong);
}

.task-partial-warning p {
  margin: 4px 0 0;
  color: var(--foreground);
}

.task-partial-warning button {
  flex: 0 0 auto;
}

.task-source-note {
  margin: 0;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-md);
  background: var(--warning-soft);
  padding: var(--space-3);
  color: var(--warning-strong);
}

.todo-panel .section-title {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

.todo-filter-tabs {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.todo-filter-tabs button {
  flex: 0 0 auto;
  white-space: nowrap;
}

@media (max-width: 560px) {
  .page {
    gap: 10px;
  }

  .toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 8px;
  }

  .toolbar .muted,
  .task-command-center .section-title p {
    display: none;
  }

  .toolbar > button {
    min-height: 36px;
    padding: 7px 10px;
  }

  .task-command-center {
    padding: 12px;
  }

  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .status-grid > div {
    min-height: 0;
    padding: 8px 10px;
  }

  .status-grid .metric {
    font-size: 18px;
  }

  .task-partial-warning {
    align-items: stretch;
    flex-direction: column;
  }

  .task-partial-warning button {
    width: 100%;
  }
}
</style>
