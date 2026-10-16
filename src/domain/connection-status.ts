import type { ConnectionDiagnostic } from '@/api/types'

export type ConnectionStatus =
  | 'not_configured'
  | 'disabled'
  | 'unchecked'
  | 'healthy'
  | 'unavailable'
  | 'reauthorize_required'
  | 'restricted'

type ConnectionStatusInput = Pick<ConnectionDiagnostic, 'type' | 'displayReason' | 'lastCheckedAt'> & {
  status: string
  configured?: boolean
  needsAttention?: boolean
}

/** Normalize older API snapshots without treating an absent check date as a failure. */
export function normalizeConnectionStatus(item: ConnectionStatusInput): ConnectionStatus {
  if (item.configured === false) return 'not_configured'
  if (item.status === 'restricted' && item.type === 'local_project' && item.displayReason === '工作区已停用。') {
    return 'disabled'
  }
  if (item.status === 'unavailable' && !item.lastCheckedAt) {
    if ((item.type === 'local_project' && item.displayReason === '尚未授权本地工作区。')
      || (item.type === 'github' && item.displayReason === '当前没有可用的 GitHub 连接。')) {
      return 'not_configured'
    }
    if (item.type === 'mcp' && item.displayReason === '需要运行连接诊断。') return 'unchecked'
  }
  switch (item.status) {
    case 'not_configured':
    case 'disabled':
    case 'unchecked':
    case 'healthy':
    case 'unavailable':
    case 'reauthorize_required':
    case 'restricted':
      return item.status
    default:
      return 'unchecked'
  }
}

export function connectionNeedsAttention(item: ConnectionStatusInput): boolean {
  const status = normalizeConnectionStatus(item)
  if (['not_configured', 'disabled', 'unchecked', 'healthy'].includes(status)) return false
  return typeof item.needsAttention === 'boolean' ? item.needsAttention : true
}

export function connectionCanDiagnose(item: ConnectionStatusInput & { diagnosable?: boolean }): boolean {
  return Boolean(item.diagnosable) && !['not_configured', 'disabled'].includes(normalizeConnectionStatus(item))
}

export function connectionStatusPresentation(item: ConnectionStatusInput, loading = false): { status: string; label: string } {
  if (loading) return { status: 'diagnosing', label: '检查中' }
  const status = normalizeConnectionStatus(item)
  switch (status) {
    case 'not_configured': return { status: 'disabled', label: '未配置' }
    case 'disabled': return { status: 'disabled', label: '未启用' }
    case 'unchecked': return { status: 'disabled', label: '待检查' }
    case 'healthy': return { status, label: '可用' }
    case 'reauthorize_required': return { status, label: '需要重新授权' }
    case 'restricted': return { status, label: '受限' }
    case 'unavailable': return { status, label: '不可用' }
  }
}
