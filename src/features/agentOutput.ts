import type { AgentArtifact, AgentStepRun } from '@/api/agentTasks'

const SENSITIVE_TOOLS = new Set(['memory.snapshot', 'research.search'])

export function safeAgentStepSummary(run: AgentStepRun | undefined, toolRef: string) {
  if (!run) return ''
  const summary = String(run.output?.summary || run.errorCode || '')
  const derivedSensitivity = sensitiveBodyType(summary)
  if (derivedSensitivity) return hiddenSummary(derivedSensitivity, false)
  if (SENSITIVE_TOOLS.has(toolRef) && run.output?.redacted !== true) {
    return hiddenSummary(toolRef === 'memory.snapshot' ? 'PERSONAL' : 'EXTERNAL_CONTENT', false)
  }
  return summary
}

export function safeAgentArtifactSummary(artifact: AgentArtifact) {
  const toolRef = String(artifact.metadata?.toolRef || '')
  const derivedSensitivity = sensitiveBodyType(artifact.summary)
  if (derivedSensitivity) return hiddenSummary(derivedSensitivity, true)
  if (SENSITIVE_TOOLS.has(toolRef) && artifact.metadata?.redacted !== true) {
    return hiddenSummary(toolRef === 'memory.snapshot' ? 'PERSONAL' : 'EXTERNAL_CONTENT', true)
  }
  return artifact.summary
}

function sensitiveBodyType(summary: string) {
  if (summary.includes('长期摘要：') || summary.includes('长期记忆摘要')) return 'PERSONAL'
  if (summary.includes('网页搜索结果：')) return 'EXTERNAL_CONTENT'
  return ''
}

function hiddenSummary(sensitivity: string, artifact: boolean) {
  if (sensitivity === 'PERSONAL') {
    return artifact
      ? '个人记忆正文已隐藏；该历史产物需要重新生成。'
      : '个人记忆正文已隐藏；请重新运行以生成结构化脱敏摘要。'
  }
  return artifact
    ? '外部网页正文已隐藏；该历史产物需要重新生成。'
    : '外部网页正文已隐藏；请重新运行以生成结构化脱敏摘要。'
}
