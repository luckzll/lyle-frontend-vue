import { describe, expect, it } from 'vitest'
import { reconcileChatTurn, recoveryPollDelay, shouldRecoverChatTurn, type RecoverableMessage } from '@/domain/chat-recovery'
import { consumeSseBuffer } from '@/api/app'
import type { ChatMessage } from '@/api/types'

const local: RecoverableMessage = {
  role: 'assistant', turnId: 'turn-1', phase: 'RESPONDING', content: '已经显示的部分正文', debugDataState: 'pending',
  agentProgress: [{ turnId: 'turn-1', sequence: 4, step: 'writer_agent', status: 'running' }]
}
const saved = (phase: string, content = '', metadata = {}): ChatMessage => ({
  id: 'm1', role: 'assistant', turnId: 'turn-1', conversationId: 'c1', content, createdAt: '', metadata: { phase, ...metadata }
})

describe('chat transport interruption recovery', () => {
  it('honors an explicit preflight FAILED event followed by error/EOF without waiting for a nonexistent history row', () => {
    const turn = { ...local }
    let done = false
    let streamError = ''
    consumeSseBuffer('event: turn.status\ndata: {"turnId":"turn-1","phase":"FAILED","message":"当前额度不足"}\n\nevent: error\ndata: {"message":"当前额度不足"}\n\n', {
      onDelta: () => undefined,
      onTurnStatus: (status) => { turn.phase = status.phase; turn.statusText = status.message },
      onError: message => { streamError = message },
      onDone: () => { done = true }
    })
    expect(done).toBe(false)
    expect(streamError).toBe('当前额度不足')
    expect(shouldRecoverChatTurn(turn)).toBe(false)
    expect(reconcileChatTurn(turn, [])).toEqual(expect.objectContaining({ phase: 'FAILED', statusText: '当前额度不足', recoveryState: undefined }))
  })

  it('does not reopen a completed turn after a late connection failure or stale history', () => {
    const turn: RecoverableMessage = { ...local, phase: 'COMPLETED', content: '最终答案' }
    expect(shouldRecoverChatTurn(turn)).toBe(false)
    expect(reconcileChatTurn(turn, [saved('RESPONDING')])).toEqual(expect.objectContaining({ phase: 'COMPLETED', content: '最终答案', recoveryState: undefined }))
    expect(shouldRecoverChatTurn(local)).toBe(true)
  })

  it('continues observing an active backend turn without losing received text or progress', () => {
    const restored = reconcileChatTurn(local, [saved('RESPONDING', '已经显示', {
      agentProgress: [{ turnId: 'turn-1', sequence: 3, step: 'writer_agent', status: 'running' }]
    })])
    expect(restored.phase).toBe('RESPONDING')
    expect(restored.recoveryState).toBe('polling')
    expect(restored.content).toBe(local.content)
    expect(restored.agentProgress?.[0].sequence).toBe(4)
    expect(restored.debugDataState).toBe('pending')
  })

  it('uses the authoritative completed answer even when final output differs from a partial draft', () => {
    const restored = reconcileChatTurn(local, [saved('COMPLETED', '最终答案', { debugVersion: 'chat-debug-v1' })])
    expect(restored.content).toBe('最终答案')
    expect(restored.phase).toBe('COMPLETED')
    expect(restored.recoveryState).toBeUndefined()
    expect(restored.debugDataState).toBe('available')
  })

  it('reports failure only when stored backend state confirms failure, including acknowledged cancellation', () => {
    const restored = reconcileChatTurn(local, [saved('FAILED', '保留的正文', { statusText: '已停止生成' })])
    expect(restored.phase).toBe('FAILED')
    expect(restored.statusText).toBe('已停止生成')
    expect(restored.content).toBe('保留的正文')
    expect(restored.recoveryState).toBeUndefined()
  })

  it('keeps missing or unknown status unconfirmed instead of treating an EOF as success or failure', () => {
    for (const history of [[], [saved('UNKNOWN')], [{ ...saved('FAILED'), turnId: 'another-turn' }]]) {
      const restored = reconcileChatTurn(local, history)
      expect(restored.phase).toBe('RESPONDING')
      expect(restored.recoveryState).toBe('unconfirmed')
      expect(restored.content).toBe(local.content)
    }
  })

  it('supports historical turn IDs stored in metadata and rejects unrelated user messages', () => {
    const record = saved('COMPLETED', '完成')
    record.turnId = undefined
    record.metadata!.turnId = local.turnId
    expect(reconcileChatTurn(local, [record]).phase).toBe('COMPLETED')
    expect(reconcileChatTurn(local, [{ ...record, role: 'user' }]).recoveryState).toBe('unconfirmed')
  })

  it('backs off repeated status failures without increasing the normal active polling delay', () => {
    expect([0, 1, 2, 3, 4, 99].map(recoveryPollDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000])
  })
})
