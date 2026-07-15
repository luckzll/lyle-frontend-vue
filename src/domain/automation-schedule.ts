const WEEKDAY_LABELS: Record<string, string> = {
  mon: '一',
  tue: '二',
  wed: '三',
  thu: '四',
  fri: '五',
  sat: '六',
  sun: '日'
}

const TIMEZONE_LABELS: Record<string, string> = {
  'Asia/Shanghai': '北京时间',
  'Asia/Hong_Kong': '香港时间',
  'Asia/Tokyo': '东京时间',
  UTC: '协调世界时'
}

const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  project: '项目',
  code: '代码',
  document: '文档'
}

export function formatAutomationTemplateCategory(category?: string | null) {
  const value = (category || '').trim().toLowerCase()
  return TEMPLATE_CATEGORY_LABELS[value] || '通用'
}

export function formatAutomationSchedule(scheduleExpr?: string | null, timezone?: string | null) {
  const expression = (scheduleExpr || '').trim().toLowerCase()
  const schedule = scheduleLabel(expression)
  const zone = timezoneLabel(timezone)
  return zone ? `${schedule}（${zone}）` : schedule
}

export function formatAutomationTrigger(triggerType?: string | null, scheduleExpr?: string | null, timezone?: string | null) {
  if (triggerType === 'project_stale') return '项目停滞时运行'
  if (triggerType === 'task_due') return '任务到期时运行'
  if (triggerType && triggerType !== 'schedule') return '满足触发条件时运行'
  return formatAutomationSchedule(scheduleExpr, timezone)
}

function scheduleLabel(expression: string) {
  if (!expression || expression === 'daily') return '每天 09:00'
  if (expression === 'hourly') return '每小时运行'
  if (expression === 'weekly') return '每周一 09:00'

  const daily = expression.match(/^daily(?:@|:)(\d{2}:\d{2})$/)
  if (daily) return `每天 ${daily[1]}`

  const weekly = expression.match(/^weekly:([a-z]{3})(?:@|:)(\d{2}:\d{2})$/)
  if (weekly) {
    const weekday = WEEKDAY_LABELS[weekly[1]]
    if (weekday) return `每周${weekday} ${weekly[2]}`
  }

  return '按设定时间运行'
}

function timezoneLabel(timezone?: string | null) {
  const value = (timezone || '').trim()
  if (!value) return ''
  return TIMEZONE_LABELS[value] || '当地时间'
}
