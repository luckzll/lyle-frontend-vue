import type { ChatDebugDataState } from '@/domain/chat-history'

export interface ChatDebugSummaryInput {
  state?: ChatDebugDataState
  truncated?: boolean
  injectedMemoryCount: number
  sourceCount: number
  toolResultCount: number
  failedToolCount?: number
  reviewBlocked?: boolean
  answerFailed?: boolean
}

function savedCount(label: string, value: number, unit: string): string {
  return Number.isFinite(value) && value >= 0
    ? `${label} ${Math.floor(value)} ${unit}`
    : `${label}数量未记录`
}

/** Summarize saved evidence, without treating complete metadata as successful execution. */
export function summarizeChatDebug(input: ChatDebugSummaryInput): string {
  const parts: string[] = []
  if (input.answerFailed) parts.push('回答未完成')
  if (input.reviewBlocked) parts.push('审核未通过')
  if (typeof input.failedToolCount === 'number' && Number.isFinite(input.failedToolCount) && input.failedToolCount > 0) {
    parts.push(`${Math.floor(input.failedToolCount)} 条工具结果失败`)
  }

  switch (input.state) {
    case 'available':
      if (input.truncated) parts.push('部分明细已截断')
      parts.push(
        savedCount('注入记忆', input.injectedMemoryCount, '条'),
        savedCount('知识片段', input.sourceCount, '个'),
        savedCount('工具结果', input.toolResultCount, '条')
      )
      break
    case 'pending':
      parts.push('正在采集，等待本轮调试快照')
      break
    case 'legacy':
      parts.push('历史回答未保存调试明细')
      break
    case 'unsupported':
      parts.push('调试快照版本暂不支持')
      break
    case 'unavailable':
      parts.push('本轮调试快照未返回')
      break
    default:
      parts.push('调试快照状态未记录')
  }
  return parts.join(' · ')
}
