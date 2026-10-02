import { describe, expect, it } from 'vitest'
import { AGENT_STEPS, type AgentStep, type AgentStepEvent } from '@/domain/chat-progress'
import { agentStepFeedback } from '@/domain/chat-step-presentation'

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
