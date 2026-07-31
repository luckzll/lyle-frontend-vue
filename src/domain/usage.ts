export function formatTokens(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value || 0)))
}

export function formatEstimatedCost(micros: number) {
  const amount = Math.max(0, Number(micros || 0)) / 1_000_000
  return `¥${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: amount > 0 && amount < 0.01 ? 3 : 2,
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 3 : 2
  })}`
}

export function formatUsageTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed)
}

export function measurementLabel(value: string) {
  if (value === 'PROVIDER_REPORTED') return '供应商实报'
  if (value === 'PARTIAL_ESTIMATE') return '部分估算'
  if (value === 'PENDING') return '同步中'
  return '系统估算'
}
