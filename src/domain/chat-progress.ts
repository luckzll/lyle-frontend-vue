import { formatTraceDuration } from './chat-trace-presentation'

export const AGENT_STEPS = {
  supervisor_agent: '理解与分流',
  memory_agent: '记忆召回',
  rag_agent: '知识库检索',
  tool_agent: '工具调用',
  gather_agent: '整理上下文',
  project_resolver: '识别项目',
  writer_agent: '生成回答',
  reviewer_agent: '质量检查'
} as const

export type AgentStep = keyof typeof AGENT_STEPS
const TIMING_LABELS: Record<string, string> = {
  query_rewrite_ms: '查询改写', recall_ms: '资料召回', embedding_ms: '查询向量化',
  vector_search_ms: '向量搜索', keyword_search_ms: '关键词搜索', rerank_ms: '结果重排',
  sufficiency_ms: '资料充分性判断', merge_ms: '结果合并', parent_expansion_ms: '补充相邻内容',
  qdrant_prepare_ms: '检索准备', writer_first_token_ms: '模型首字等待', first_delta_ms: '首次正文返回',
  writer_ms: '回答生成', review_ms: '回答检查', prepare_context_ms: '上下文准备', total_ms: '总耗时',
  supervisor_ms: '理解与分流', memory_ms: '记忆召回', rag_ms: '知识库检索', tool_ms: '工具调用',
  gather_ms: '整理上下文', project_resolver_ms: '识别项目', diagnostics_ms: '诊断信息汇总'
}

export function stageTimingLabel(key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(TIMING_LABELS, key)) return TIMING_LABELS[key]
  const match = /^query_([1-4])(?:_(embedding|vector_search|keyword_search|rerank|qdrant_prepare|recall|parent_expansion|merge))?_ms$/.exec(key)
  if (!match) return undefined
  return `查询 ${match[1]}${match[2] ? ` · ${TIMING_LABELS[`${match[2]}_ms`]}` : ''}`
}

export function sanitizeStageTimings(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const timings = Object.fromEntries(Object.entries(value).filter(([key, item]) => (
    Boolean(stageTimingLabel(key)) && typeof item === 'number' && Number.isFinite(item) && item >= 0
  )).slice(0, 64)) as Record<string, number>
  return Object.keys(timings).length ? timings : undefined
}

export interface AgentStepEvent {
  turnId: string
  sequence: number
  step: AgentStep
  status: 'running' | 'completed' | 'failed' | 'skipped'
  durationMs?: number
  summary?: string
  timings?: Record<string, number>
}

export function sanitizeAgentStep(value: unknown, turnId?: string): AgentStepEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.turnId !== 'string' || !item.turnId || (turnId && item.turnId !== turnId)) return undefined
  if (typeof item.sequence !== 'number' || !Number.isSafeInteger(item.sequence) || item.sequence < 0) return undefined
  if (typeof item.step !== 'string' || !Object.prototype.hasOwnProperty.call(AGENT_STEPS, item.step)) return undefined
  if (!['running', 'completed', 'failed', 'skipped'].includes(String(item.status))) return undefined
  const timings = sanitizeStageTimings(item.timings)
  return {
    turnId: item.turnId,
    sequence: item.sequence,
    step: item.step as AgentStep,
    status: item.status as AgentStepEvent['status'],
    ...(typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0 ? { durationMs: item.durationMs } : {}),
    ...(typeof item.summary === 'string' && item.summary.trim() ? { summary: item.summary.trim().slice(0, 500) } : {}),
    ...(timings && Object.keys(timings).length ? { timings } : {})
  }
}

/** Keep the latest real event for each step. Never synthesize execution from missing metadata. */
export function mergeAgentProgress(current: AgentStepEvent[] | undefined, incoming: unknown, turnId?: string): AgentStepEvent[] {
  const latest = new Map<AgentStep, AgentStepEvent>()
  for (const raw of [...(current || []), ...(Array.isArray(incoming) ? incoming : [incoming])]) {
    const event = sanitizeAgentStep(raw, turnId)
    if (!event) continue
    const previous = latest.get(event.step)
    if (!previous || event.sequence > previous.sequence) latest.set(event.step, event)
  }
  return [...latest.values()].sort((left, right) => left.sequence - right.sequence)
}

export function agentProgressState(progress: AgentStepEvent[] | undefined, step: AgentStep, phase?: string) {
  const event = progress?.find((item) => item.step === step)
  return event ? agentProgressDisplayStatus(event, phase) : 'pending'
}

/** Old persisted turns may lack a closing step event. Preserve the record, but never imply it is still running. */
export function agentProgressDisplayStatus(event: AgentStepEvent, phase?: string): AgentStepEvent['status'] | 'interrupted' {
  return event.status === 'running' && phase === 'FAILED' ? 'interrupted' : event.status
}

export function agentProgressLabel(status: AgentStepEvent['status'] | 'pending' | 'interrupted') {
  return { pending: '待开始', running: '进行中', completed: '已完成', failed: '失败', skipped: '已跳过', interrupted: '已中断' }[status]
}

export function agentProgressDetail(progress: AgentStepEvent[] | undefined, step: AgentStep, phase?: string) {
  const event = progress?.find((item) => item.step === step)
  if (!event) return '等待步骤状态'
  if (agentProgressDisplayStatus(event, phase) === 'interrupted') return '本轮已中断，此步骤未完成'
  return [event.summary || agentProgressLabel(event.status), formatTraceDuration(event.durationMs)].filter(Boolean).join(' · ')
}
