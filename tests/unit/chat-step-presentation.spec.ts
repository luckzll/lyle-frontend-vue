import { describe, expect, it } from 'vitest'
import { AGENT_STEPS, type AgentStep, type AgentStepEvent } from '@/domain/chat-progress'
import { agentStepFeedback, agentStepPresentation } from '@/domain/chat-step-presentation'

const event: AgentStepEvent = { turnId: 'turn-1', sequence: 1, step: 'rag_agent', status: 'running' }

describe('step feedback presentation', () => {
  it('uses returned progress summaries for running, completed, skipped, and failed steps', () => {
    for (const status of ['running', 'completed', 'skipped', 'failed'] as const) {
      expect(agentStepFeedback({ ...event, status, summary: '  实际返回的状态说明  ' }, status)).toBe('实际返回的状态说明')
    }
    expect(agentStepFeedback({ ...event, status: 'completed', summary: '检索 1 次，未命中相关片段' }, 'completed'))
      .toBe('检索 1 次，未命中相关片段')
  })

  it('provides a stage sentence for every recorded step when older events have no summary', () => {
    for (const step of Object.keys(AGENT_STEPS) as AgentStep[]) {
      expect(agentStepFeedback({ ...event, step }, 'running')).toMatch(/^正在/)
      expect(agentStepFeedback({ ...event, step, status: 'completed' }, 'completed')).toBeTruthy()
      expect(agentStepFeedback({ ...event, step, status: 'skipped' }, 'skipped')).toBe(`本轮未执行${AGENT_STEPS[step]}`)
    }
  })

  it('does not invent a recall match, confirmed project, or successful tool operation for older completed events', () => {
    expect(agentStepFeedback({ ...event, step: 'memory_agent', status: 'completed' }, 'completed')).toBe('记忆召回已结束')
    expect(agentStepFeedback({ ...event, step: 'project_resolver', status: 'completed' }, 'completed')).toBe('项目识别已结束')
    expect(agentStepFeedback({ ...event, step: 'tool_agent', status: 'completed' }, 'completed')).toBe('工具调用已结束')
    expect(agentStepFeedback({ ...event, step: 'writer_agent', status: 'completed', summary: '步骤已完成' }, 'completed')).toBe('回答生成已结束')
    expect(agentStepFeedback({ ...event, status: 'skipped', summary: '本轮无需执行此步骤' }, 'skipped')).toBe('本轮未执行知识库检索')
  })

  it('replaces an old running summary after a turn has ended or been interrupted', () => {
    const running = { ...event, summary: '正在检索知识库' }
    expect(agentStepFeedback(running, 'ended')).toBe('本轮已结束，未收到此步骤的完成状态')
    expect(agentStepFeedback(running, 'interrupted')).toBe('本轮已中断，此步骤未完成')
    expect(agentStepFeedback(running, 'failed')).toBe('知识库检索未能完成，请重试')
    expect(agentStepFeedback(running, 'pending')).toBeUndefined()
  })
})

describe('reported actions and internal graph stages', () => {
  it('classifies routing, assembly and answer generation as processing stages', () => {
    for (const step of ['supervisor_agent', 'gather_agent', 'writer_agent'] as const) {
      expect(agentStepPresentation({ ...event, step, status: 'completed' })).toBe('internal')
    }
  })

  it('shows reported recall and retrieval regardless of elapsed time, while skipped work stays hidden', () => {
    for (const step of ['memory_agent', 'rag_agent'] as const) {
      for (const durationMs of [0, 1, 120000]) expect(agentStepPresentation({ ...event, step, durationMs })).toBe('action')
      expect(agentStepPresentation({ ...event, step, status: 'skipped' })).toBe('hidden')
    }
  })

  it('avoids counting aggregate tool orchestration as an invocation or duplicating real calls', () => {
    expect(agentStepPresentation({ ...event, step: 'tool_agent' })).toBe('internal')
    expect(agentStepPresentation({ ...event, step: 'tool_agent' }, true)).toBe('hidden')
    expect(agentStepPresentation({ ...event, step: 'tool_agent', status: 'failed' }, true)).toBe('internal')
  })

  it('requires explicit project and model-review outcomes for older untyped events', () => {
    expect(agentStepPresentation({ ...event, step: 'project_resolver', status: 'completed' })).toBe('internal')
    expect(agentStepPresentation({ ...event, step: 'project_resolver', summary: '未匹配到项目，继续使用本轮对话上下文' })).toBe('internal')
    expect(agentStepPresentation({ ...event, step: 'project_resolver', summary: '已识别关联项目并取得项目上下文' })).toBe('action')
    const clarification = { ...event, step: 'project_resolver' as const, status: 'completed' as const, summary: '项目归属仍需确认，暂未采用项目上下文' }
    expect(agentStepPresentation(clarification)).toBe('internal')
    expect(agentStepFeedback(clarification, 'completed')).toBe('项目归属未确定，本轮继续使用对话上下文。')
    expect(agentStepFeedback({ ...clarification, status: 'failed' }, 'failed')).toBe(clarification.summary)
    expect(agentStepPresentation({ ...event, step: 'reviewer_agent', summary: '内容检查完成' })).toBe('internal')
    expect(agentStepPresentation({ ...event, step: 'reviewer_agent', summary: '已完成回答内容的规则检查' })).toBe('internal')
    expect(agentStepPresentation({ ...event, step: 'reviewer_agent', summary: '模型复核完成' })).toBe('action')
    expect(agentStepPresentation({ ...event, step: 'reviewer_agent', summary: '正在进行模型复核' })).toBe('action')
  })

  it('keeps reported failures visible even when the successful stage is normally internal', () => {
    for (const step of Object.keys(AGENT_STEPS) as AgentStep[]) {
      expect(agentStepPresentation({ ...event, step, status: 'failed' })).toBe('action')
    }
  })
})
