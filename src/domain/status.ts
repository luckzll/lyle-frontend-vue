export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export type StatusPresentation = {
  tone: StatusTone
  label: string
}

const STATUS_MAP: Record<string, StatusPresentation> = {
  draft: { tone: 'neutral', label: '草稿' },
  planning: { tone: 'info', label: '制定计划中' },
  awaiting_plan_approval: { tone: 'warning', label: '待批准' },
  ready: { tone: 'info', label: '准备中' },
  completed: { tone: 'success', label: '已完成' },
  partially_completed: { tone: 'warning', label: '部分完成' },
  healthy: { tone: 'success', label: '可用' },
  active: { tone: 'success', label: '运行中' },
  enabled: { tone: 'success', label: '运行中' },
  done: { tone: 'success', label: '已完成' },
  pending: { tone: 'warning', label: '等待处理' },
  awaiting_confirmation: { tone: 'warning', label: '待确认' },
  awaiting_input: { tone: 'warning', label: '待补充' },
  reauthorize_required: { tone: 'warning', label: '需要重新授权' },
  partial: { tone: 'warning', label: '部分完成' },
  restricted: { tone: 'warning', label: '受限' },
  overdue: { tone: 'danger', label: '已逾期' },
  failed: { tone: 'danger', label: '失败' },
  unavailable: { tone: 'danger', label: '不可用' },
  paused: { tone: 'neutral', label: '已暂停' },
  pausing: { tone: 'neutral', label: '暂停中' },
  disabled: { tone: 'neutral', label: '未启用' },
  cancelled: { tone: 'neutral', label: '已取消' },
  running: { tone: 'info', label: '执行中' },
  diagnosing: { tone: 'info', label: '检查中' },
  scheduled: { tone: 'info', label: '已安排' }
}

export function statusPresentation(status?: string | null): StatusPresentation {
  const normalized = String(status || '').trim().toLowerCase()
  return STATUS_MAP[normalized] ?? {
    tone: 'neutral',
    label: normalized || '状态未知'
  }
}
