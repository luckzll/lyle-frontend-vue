export function formatCredits(value: number) {
  const credits = Math.max(0, Number(value || 0)) / 1_000_000
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: credits < 10 ? 2 : 0
  }).format(credits)
}

export function formatBillingTime(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed)
}

export function orderStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    CREATED: '待支付',
    PENDING_PAYMENT: '待支付',
    PAID: '付款已确认',
    FULFILLING: '权益发放中',
    FULFILLED: '已完成',
    CLOSED: '已关闭',
    CANCELLED: '已取消',
    REFUNDING: '退款处理中',
    REFUNDED: '已退款'
  }
  return labels[String(status || '').toUpperCase()] || '需要帮助'
}

export function orderStatusTone(status?: string | null) {
  if (status === 'FULFILLED') return 'success'
  if (['PAID', 'FULFILLING', 'PENDING_PAYMENT', 'CREATED', 'REFUNDING'].includes(String(status))) return 'warning'
  if (status === 'REFUNDED') return 'neutral'
  return 'danger'
}

export function refundStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    REVIEW_REQUIRED: '等待人工审核',
    PROCESSING: '退款处理中',
    SUCCEEDED: '退款成功',
    FAILED: '退款失败'
  }
  return labels[String(status || '').toUpperCase()] || '退款状态待确认'
}

export function purchaseIntentLabel(intent?: string | null) {
  const labels: Record<string, string> = {
    NEW_PURCHASE: '新购',
    RENEWAL: '续期',
    ADD_ON: '额度包'
  }
  return labels[String(intent || '').toUpperCase()] || '其他购买'
}

export function paymentProviderLabel(provider?: string | null) {
  if (!provider) return '—'
  const labels: Record<string, string> = {
    MOCK: '开发沙箱',
    WECHAT: '微信支付',
    WECHAT_PAY: '微信支付',
    ALIPAY: '支付宝'
  }
  return labels[String(provider).toUpperCase()] || '其他支付方式'
}

export function ledgerLabel(type: string) {
  const labels: Record<string, string> = {
    FREE_GRANT: '免费额度到账',
    PURCHASE_GRANT: '购买额度到账',
    PROMOTION_GRANT: '赠送额度到账',
    USAGE_DEBIT: 'AI 任务消耗',
    EXPIRATION: '额度到期',
    REFUND_REVERSAL: '退款调整',
    MANUAL_ADJUSTMENT: '客服调整',
    CORRECTION: '系统修正'
  }
  return labels[type] || '额度调整'
}

export function safeReturnTo(value: unknown, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
    const parsed = new URL(value, origin)
    if (parsed.origin !== origin || parsed.pathname.startsWith('/login')) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
