const ISO_DATE_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})\b/g

export function formatBeijingTime(value?: string | null, fallback = '时间待确认') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date)
  return `${text}，北京时间`
}

export function humanizeIsoDateTimes(value?: string | null) {
  if (!value) return ''
  return value.replace(ISO_DATE_TIME, (match) => formatBeijingTime(match, match))
}
