import { AGENT_STEPS, type AgentStep, type AgentStepEvent } from './chat-progress'

const STEP_FEEDBACK: Record<AgentStep, { running: string; completed: string }> = {
  supervisor_agent: { running: '正在识别请求类型并选择处理步骤', completed: '请求分流已结束' },
  memory_agent: { running: '正在查找与本轮对话相关的历史上下文', completed: '记忆召回已结束' },
  rag_agent: { running: '正在查找知识库中的相关资料', completed: '知识库检索已结束' },
  tool_agent: { running: '正在选择工具并等待调用结果', completed: '工具调用已结束' },
  gather_agent: { running: '正在汇总各步骤返回的上下文', completed: '上下文整理已结束' },
  project_resolver: { running: '正在检查本轮对话关联的项目', completed: '项目识别已结束' },
  writer_agent: { running: '正在整理上下文并生成回答', completed: '回答生成已结束' },
  reviewer_agent: { running: '正在检查回答内容', completed: '回答内容检查已结束' }
}
const GENERIC_SUMMARIES = new Set(['步骤已完成', '已完成', '进行中', '已跳过', '失败', '本轮无需执行此步骤'])

/** Show real status feedback; missing summaries never imply a match or successful operation. */
export function agentStepFeedback(item: AgentStepEvent, displayStatus: string): string | undefined {
  if (displayStatus === 'interrupted') return '本轮已中断，此步骤未完成'
  if (displayStatus === 'ended') return '本轮已结束，未收到此步骤的完成状态'
  if (!['running', 'completed', 'failed', 'skipped'].includes(displayStatus)) return undefined

  const summary = item.summary?.trim()
  if (summary && !GENERIC_SUMMARIES.has(summary) && displayStatus === item.status) return summary
  if (displayStatus === 'failed') return `${AGENT_STEPS[item.step]}未能完成，请重试`
  if (displayStatus === 'skipped') return `本轮未执行${AGENT_STEPS[item.step]}`
  return STEP_FEEDBACK[item.step][displayStatus as 'running' | 'completed']
}
