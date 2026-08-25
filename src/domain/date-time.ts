const ISO_DATE_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})\b/g
const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i

export function parseServerDateTime(value?: string | null) {
  if (!value) return null
  const isoValue = value.includes(' ') ? value.replace(' ', 'T') : value
  // Java LocalDateTime responses represent UTC database values but carry no offset.
  // Make that contract explicit so rendering does not depend on the browser timezone.
  const normalized = OFFSET_SUFFIX.test(isoValue) ? isoValue : `${isoValue}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatBeijingTime(value?: string | null, fallback = '时间待确认') {
  const date = parseServerDateTime(value)
  if (!date) return fallback
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

export function formatBeijingTimeShort(value?: string | null, fallback = '暂无记录') {
  const date = parseServerDateTime(value)
  if (!date) return fallback
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date)
}

export function humanizeIsoDateTimes(value?: string | null) {
  if (!value) return ''
  return value.replace(ISO_DATE_TIME, (match) => formatBeijingTime(match, match))
}
