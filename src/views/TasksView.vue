<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  deleteAgentCalendar,
  deleteAgentTodo,
  listAgentCalendar,
  listAgentReminders,
  listAgentTodos,
  markAgentReminderRead,
  updateAgentTodoDueAt,
  updateAgentCalendarStatus,
  updateAgentTodoStatus
} from '@/api/app'
import type { AgentCalendarItem, AgentReminderItem, AgentTodoItem } from '@/api/types'

const todos = ref<AgentTodoItem[]>([])
const calendar = ref<AgentCalendarItem[]>([])
const reminders = ref<AgentReminderItem[]>([])
const loading = ref(false)
const activeTab = ref<'open' | 'today' | 'overdue' | 'done' | 'cancelled' | 'all'>('open')
const dueEdits = ref<Record<number, string>>({})
const notice = ref('')
const selectedDate = ref(startOfDay(new Date()).toISOString())
const calendarWindowStart = ref(startOfWeek(new Date()).toISOString())
const calendarScope = ref<'day' | 'week'>('day')

const visibleTodos = computed(() => {
  const source = activeTab.value === 'open'
    ? todos.value.filter((item) => item.status === 'open')
    : activeTab.value === 'today'
      ? todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt))
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

async function refresh() {
  loading.value = true
  try {
    const [todoResponse, calendarResponse, reminderResponse] = await Promise.all([
      listAgentTodos(),
      listAgentCalendar(),
      listAgentReminders()
    ])
    todos.value = todoResponse.data.items
    calendar.value = calendarResponse.data.items
    reminders.value = reminderResponse.data.items
  } finally {
    loading.value = false
  }
}

async function setTodoStatus(id: number, status: string) {
  await updateAgentTodoStatus(id, status)
  showNotice(status === 'done' ? '待办已完成' : status === 'cancelled' ? '待办已取消' : '待办已重新打开')
  await refresh()
}

async function saveTodoDueAt(item: AgentTodoItem) {
  const value = dueEdits.value[item.id]
  await updateAgentTodoDueAt(item.id, value ? new Date(value).toISOString() : null)
  showNotice('截止时间已保存')
  await refresh()
}

async function postponeTodoToTomorrow(item: AgentTodoItem) {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  await updateAgentTodoDueAt(item.id, next.toISOString())
  showNotice('已顺延到明天 9 点')
  await refresh()
}

async function removeTodo(id: number) {
  await deleteAgentTodo(id)
  showNotice('待办已删除')
  await refresh()
}

async function setCalendarStatus(id: number, status: string) {
  await updateAgentCalendarStatus(id, status)
  showNotice(status === 'done' ? '日历事件已完成' : '日历事件已取消')
  await refresh()
}

async function removeCalendar(id: number) {
  await deleteAgentCalendar(id)
  showNotice('日历事件已删除')
  await refresh()
}

async function readReminder(id: number) {
  await markAgentReminderRead(id)
  showNotice('提醒已标记已读')
  await refresh()
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
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>任务</h1>
        <p class="muted">查看智能体创建的待办、日历事件和到期提醒，持续追踪可靠执行状态。</p>
      </div>
      <button :disabled="loading" type="button" @click="refresh">刷新</button>
    </div>
    <p v-if="notice" class="toast">{{ notice }}</p>

    <div class="status-grid">
      <div>
        <span class="metric">{{ openTodos.length }}</span>
        <span class="muted">进行中待办</span>
      </div>
      <div>
        <span class="metric">{{ todayTodos.length }}</span>
        <span class="muted">今日到期</span>
      </div>
      <div>
        <span class="metric">{{ overdueTodos.length }}</span>
        <span class="muted">已逾期</span>
      </div>
      <div>
        <span class="metric">{{ unreadReminders.length }}</span>
        <span class="muted">未读提醒</span>
      </div>
    </div>

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
            <button class="inline secondary" type="button" @click="postponeTodoToTomorrow(nextTodo)">明天 9 点</button>
            <button class="inline" type="button" @click="setTodoStatus(nextTodo.id, 'done')">完成</button>
          </span>
        </section>
        <section v-if="unreadReminderPreview" class="task-focus-card pending">
          <small class="memory-meta">未读提醒</small>
          <strong>{{ unreadReminderPreview.title }}</strong>
          <span>{{ unreadReminderPreview.message }}</span>
          <button class="inline" type="button" @click="readReminder(unreadReminderPreview.id)">标记已读</button>
        </section>
        <section v-if="duplicateTodoCount > 0" class="task-focus-card pending">
          <small class="memory-meta">重复提醒</small>
          <strong>已隐藏 {{ duplicateTodoCount }} 个重复待办</strong>
          <span>列表按标题、状态和截止时间去重展示，避免测试数据干扰执行判断。</span>
        </section>
      </div>
    </article>

    <article class="item collapsible-section">
      <div class="section-title">
        <div>
          <h2>提醒</h2>
          <p class="muted">展示由待办、日历和 Agent 跟进产生的提醒。</p>
        </div>
        <span class="badge">{{ unreadReminders.length }} 未读</span>
      </div>
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
            @click="readReminder(item.id)"
          >
            标记已读
          </button>
          <small v-else class="memory-meta">已读</small>
        </span>
      </div>
    </article>

    <div class="grid">
      <article class="item">
        <div class="section-title">
          <h2>待办</h2>
          <div class="segmented">
            <button :class="{ active: activeTab === 'open' }" type="button" @click="activeTab = 'open'">进行中 {{ tabCount('open') }}</button>
            <button :class="{ active: activeTab === 'today' }" type="button" @click="activeTab = 'today'">今日 {{ tabCount('today') }}</button>
            <button :class="{ active: activeTab === 'overdue' }" type="button" @click="activeTab = 'overdue'">逾期 {{ tabCount('overdue') }}</button>
            <button :class="{ active: activeTab === 'done' }" type="button" @click="activeTab = 'done'">已完成 {{ tabCount('done') }}</button>
            <button :class="{ active: activeTab === 'cancelled' }" type="button" @click="activeTab = 'cancelled'">已取消 {{ tabCount('cancelled') }}</button>
            <button :class="{ active: activeTab === 'all' }" type="button" @click="activeTab = 'all'">全部 {{ tabCount('all') }}</button>
          </div>
        </div>
        <p v-if="visibleTodos.length === 0" class="muted">暂无待办。你可以在聊天里说“创建待办：整理知识库”。</p>
        <div v-for="item in visibleTodos" :key="item.id" class="task-row" :class="{ disabled: item.status !== 'open', danger: isOverdue(item), pending: isToday(item.dueAt) }">
          <strong>
            {{ item.title }}
            <span v-if="isOverdue(item)" class="badge danger">逾期</span>
            <span v-else-if="isToday(item.dueAt)" class="badge pending">今日</span>
          </strong>
          <span>{{ statusText(item.status) }} · {{ todoTimeText(item) }}</span>
          <small v-if="item.sourceRef" class="memory-meta">来源证据：{{ item.sourceRef }}</small>
          <small v-if="goalLinkText(item)" class="memory-meta">
            关联目标：{{ goalLinkText(item) }}
          </small>
          <span v-if="item.status === 'open'" class="row">
            <input
              class="inline-input"
              type="datetime-local"
              :value="todoDueInputValue(item)"
              @input="setTodoDueEdit(item, $event)"
            />
            <button class="inline secondary" type="button" @click="saveTodoDueAt(item)">保存时间</button>
            <button class="inline secondary" type="button" @click="postponeTodoToTomorrow(item)">明天 9 点</button>
          </span>
          <span class="row">
            <button v-if="item.status !== 'done'" class="inline" type="button" @click="setTodoStatus(item.id, 'done')">完成</button>
            <button v-if="item.status !== 'open'" class="inline secondary" type="button" @click="setTodoStatus(item.id, 'open')">重新打开</button>
            <button v-if="item.status !== 'cancelled'" class="inline secondary" type="button" @click="setTodoStatus(item.id, 'cancelled')">取消</button>
            <button class="inline danger" type="button" @click="removeTodo(item.id)">删除</button>
          </span>
        </div>
      </article>

      <article class="item execution-calendar">
        <div class="section-title">
          <div>
            <h2>执行日历</h2>
            <p class="muted">点击日期查看当天待办、日历事件和提醒。</p>
          </div>
          <span class="badge">{{ calendarTotal }} 项</span>
        </div>

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
              <button class="inline" type="button" @click="setTodoStatus(item.id, 'done')">完成</button>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && selectedDayTodos.length" class="stack">
            <small class="memory-meta">待办截止</small>
            <div v-for="item in selectedDayTodos" :key="`todo-${item.id}`" class="calendar-agenda-item" :class="{ danger: isOverdue(item), pending: isToday(item.dueAt) }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ todoTimeText(item) }}</span>
              </div>
              <button class="inline" type="button" @click="setTodoStatus(item.id, 'done')">完成</button>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && selectedDayEvents.length" class="stack">
            <small class="memory-meta">日历事件</small>
            <div v-for="item in selectedDayEvents" :key="`event-${item.id}`" class="calendar-agenda-item">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ statusText(item.status) }} · {{ calendarTimeText(item.startsAt) }}</span>
                <small v-if="item.sourceRef" class="memory-meta">来源：{{ item.sourceRef }}</small>
              </div>
              <span class="row">
                <button class="inline" type="button" @click="setCalendarStatus(item.id, 'done')">完成</button>
                <button class="inline secondary" type="button" @click="setCalendarStatus(item.id, 'cancelled')">取消</button>
                <button class="inline danger" type="button" @click="removeCalendar(item.id)">删除</button>
              </span>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && selectedDayReminders.length" class="stack">
            <small class="memory-meta">提醒记录</small>
            <div v-for="item in selectedDayReminders" :key="`reminder-${item.id}`" class="calendar-agenda-item" :class="{ disabled: item.status === 'read' }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.message }} · {{ reminderTimeText(item.createdAt) }}</span>
              </div>
              <button v-if="item.status !== 'read'" class="inline" type="button" @click="readReminder(item.id)">已读</button>
            </div>
          </section>

          <section v-if="calendarScope === 'day' && weekDueTodos.length" class="stack">
            <small class="memory-meta">本周到期</small>
            <div v-for="item in weekDueTodos.slice(0, 4)" :key="`week-preview-${item.id}`" class="calendar-agenda-item" :class="{ danger: isOverdue(item), pending: isToday(item.dueAt) }">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ todoTimeText(item) }}</span>
              </div>
              <button class="inline" type="button" @click="setTodoStatus(item.id, 'done')">完成</button>
            </div>
          </section>

          <div v-if="calendarTotal === 0 && weekDueTodos.length === 0" class="empty-state compact">
            <strong>{{ calendarScope === 'week' ? '未来 7 天暂无到期待办' : '当天暂无安排' }}</strong>
            <span>可以在聊天里说“创建日历：明天 10 点开会”，或给待办设置截止时间。</span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
