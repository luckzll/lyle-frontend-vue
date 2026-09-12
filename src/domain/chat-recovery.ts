import type { ChatMessage } from '@/api/types'
import { historyMessage, isActiveTurnPhase, type RecoveredChatMessage } from './chat-history'
import { mergeAgentProgress } from './chat-progress'

export type ChatRecoveryState = 'checking' | 'polling' | 'unconfirmed'
export type RecoverableMessage = RecoveredChatMessage & { recoveryState?: ChatRecoveryState }

export function shouldRecoverChatTurn(message: RecoverableMessage): boolean {
  return message.phase !== 'COMPLETED' && message.phase !== 'FAILED'
}

/** A broken transport says nothing about the independent backend turn's outcome. */
export function reconcileChatTurn(local: RecoverableMessage, history: ChatMessage[]): RecoverableMessage {
  // Explicit server terminal events are authoritative even if preflight rejection created no history row.
  if (!shouldRecoverChatTurn(local)) return { ...local, recoveryState: undefined }
  const stored = history.find((item) => item.role === 'assistant' && (item.turnId || item.metadata?.turnId) === local.turnId)
  if (!stored) return { ...local, recoveryState: 'unconfirmed' }
  const recovered = historyMessage(stored)
  if (recovered.phase === 'COMPLETED' || recovered.phase === 'FAILED') return {
    ...local, ...recovered,
    agentProgress: mergeAgentProgress(local.agentProgress, recovered.agentProgress, local.turnId),
    recoveryState: undefined
  }
  if (!isActiveTurnPhase(recovered.phase)) return { ...local, recoveryState: 'unconfirmed' }
  return {
    ...local,
    ...recovered,
    // Persistence may trail the last received delta. Do not erase visible output during polling.
    content: recovered.content.length >= local.content.length ? recovered.content : local.content,
    agentProgress: mergeAgentProgress(local.agentProgress, recovered.agentProgress, local.turnId),
    recoveryState: 'polling'
  }
}

export function recoveryStatusText(state: ChatRecoveryState) {
  return {
    checking: '连接已中断，正在确认后台状态…',
    polling: '后台仍在执行，正在同步进度…',
    unconfirmed: '暂时无法确认后台状态，正在重新查询，请勿重复提交。'
  }[state]
}

export function recoveryPollDelay(failures: number) {
  return Math.min(10000, 1000 * 2 ** Math.min(Math.max(0, failures), 4))
}
