import type { AgentTraceItem, ProjectChatContext } from '@/api/types'

export type AgentTraceTone = 'success' | 'neutral' | 'warning' | 'danger' | 'running'

export interface AgentTracePresentation {
  name: string
  purpose: string
  statusLabel: string
  tone: AgentTraceTone
  summary: string
  duration: string | null
}

export interface AgentTracePresentationContext {
  projectContext?: ProjectChatContext
  /** The response-level review belongs to the final reviewer, not earlier retries. */
  review?: Record<string, unknown>
}

const NODE_COPY: Record<string, { name: string; purpose: string; missing: string }> = {
  supervisor_agent: { name: '理解与分流', purpose: '判断问题需要哪些信息与能力', missing: '未保存本轮选择的处理步骤' },
  memory_agent: { name: '记忆召回', purpose: '检索与问题相关的个人记忆', missing: '未保存本轮记忆召回结果' },
  rag_agent: { name: '知识库检索', purpose: '搜索知识库中的相关文档片段', missing: '未保存本轮知识库检索结果' },
  tool_agent: { name: '工具调用', purpose: '按需调用工具获取信息或执行操作', missing: '未保存本轮工具处理结果' },
  gather_agent: { name: '整理上下文', purpose: '汇集记忆、知识库和工具返回的信息', missing: '未保存本轮汇集的信息来源' },
  project_resolver: { name: '识别项目', purpose: '判断当前问题属于哪个项目', missing: '已进入项目识别步骤，未保存具体匹配结果' },
  writer_agent: { name: '生成回答', purpose: '结合本轮上下文组织回答', missing: '未保存本轮回答生成结果' },
  reviewer_agent: { name: '质量检查', purpose: '检查回答质量与资料依据', missing: '未保存本轮质量检查结果' }
}

const IMAGE_TOOL_COPY: Record<string, { name: string; purpose: string }> = {
  image_analyze: { name: '图片分析', purpose: '分析用户提供的图片内容' },
  image_generate: { name: '图片生成', purpose: '根据本轮要求生成图片' },
  image_edit: { name: '图片编辑', purpose: '根据本轮要求修改图片' }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((name) => NODE_COPY[text(name)]?.name || '其他处理'))]
}

function reasonText(value: unknown): string {
  const reason = text(value)
  if (reason === 'Reviewer disabled') return '模型复核未开启'
  if (reason.startsWith('explicit_project_unavailable:')) return '当前指定的项目暂时不可用'
  if (reason.startsWith('project_store_unavailable:')) return '项目数据暂时不可用'
  // Raw implementation identifiers belong in diagnostic details, not timeline copy.
  if (/^[\w.:/-]+$/.test(reason)) return ''
  return reason
}

export function formatTraceDuration(value: unknown): string | null {
  const milliseconds = count(value)
  if (milliseconds === undefined) return null
  if (milliseconds < 1000) return `${Math.round(milliseconds)} 毫秒`
  return `${Number((milliseconds / 1000).toFixed(2))} 秒`
}

/** Present only facts contained in the sanitized trace or its matching context. */
export function presentAgentTrace(
  item: AgentTraceItem,
  context: AgentTracePresentationContext = {}
): AgentTracePresentation {
  const copy = NODE_COPY[item.agent] || {
    name: '其他处理', purpose: '本轮对话中的附加处理步骤', missing: '未保存此步骤的结果摘要'
  }
  const result: AgentTracePresentation = {
    name: copy.name,
    purpose: copy.purpose,
    statusLabel: '结果未记录',
    tone: 'neutral',
    summary: copy.missing,
    duration: formatTraceDuration(item.elapsedMs ?? item.durationMs)
  }
  const action = text(item.action)
  const status = text(item.status).toLowerCase()
  const review = item.agent === 'reviewer_agent' ? context.review : undefined
  const reason = reasonText(item.decision?.reason) || reasonText(item.reason)
  const reviewReason = reasonText(review?.reason)
  const mark = (label: string, tone: AgentTraceTone, summary: string) => {
    result.statusLabel = label
    result.tone = tone
    result.summary = summary
    return result
  }

  if (item.agent === 'memory_agent' && ['candidate_ready', 'write'].includes(action)) {
    result.name = action === 'write' ? '记忆写入' : '记忆整理'
    result.purpose = action === 'write' ? '保存本轮形成的记忆' : '从本轮对话整理可保存的候选记忆'
  }
  const imageTool = item.agent === 'tool_agent' ? IMAGE_TOOL_COPY[text(item.tool)] : undefined
  if (imageTool) {
    result.name = imageTool.name
    result.purpose = imageTool.purpose
  }

  // An explicit failure overrides generic completion or skip flags.
  if (['failed', 'error', 'rejected'].includes(status) || item.ok === false || item.error) {
    return mark('执行失败', 'danger', reason || '此步骤未成功完成，详细原因未保存')
  }
  if (item.approved === false || item.ruleBlocked === true || action === 'quality_blocked') {
    return mark('未通过', 'danger', reviewReason || reason || '回答未通过质量检查')
  }
  if (['cancelled', 'canceled'].includes(status)) {
    return mark('已停止', 'neutral', reason || '此步骤已停止')
  }
  if (item.skipped === true || status === 'skipped') {
    if (item.agent === 'reviewer_agent') {
      // approved + skipped alone is not evidence of a model review or a rule pass.
      const explicitRulePass = /规则.*通过/.test(reviewReason)
      const summary = text(review?.reason) === 'Reviewer disabled'
        ? '模型复核未开启，本轮未执行模型复核'
        : explicitRulePass
          ? `${reviewReason}；未执行模型复核`
          : reviewReason || reason || '本轮跳过质量复核，未保存具体原因'
      return mark('已跳过', 'neutral', summary)
    }
    return mark('已跳过', 'neutral', reason || '本轮未执行此步骤')
  }
  if (['running', 'in_progress', 'processing'].includes(status)) {
    return mark('进行中', 'running', reason || result.purpose)
  }
  if (['pending', 'queued', 'scheduled'].includes(status)) {
    return mark('等待处理', 'neutral', reason || '已安排此步骤，结果尚未返回')
  }

  if (item.agent === 'project_resolver') {
    const resolver = context.projectContext?.resolver || record(item.resolver)
    if (!resolver) return result
    const projectName = text(resolver.projectName)
    const projectReason = reasonText(resolver.reason)
    if (/^(explicit_project_unavailable|project_store_unavailable):/.test(text(resolver.reason))) {
      return mark('暂不可用', 'warning', projectReason)
    }
    if (resolver.requiresClarification === true) {
      return mark('需要确认', 'warning', projectReason || '项目归属尚不明确，需要确认后再关联')
    }
    if (resolver.projectId != null || projectName) {
      return mark(
        resolver.linkedConversation === true ? '已关联' : '已匹配',
        'success',
        [projectName ? `匹配项目「${projectName}」` : '已匹配到项目', projectReason].filter(Boolean).join(' · ')
      )
    }
    if (projectReason || Object.prototype.hasOwnProperty.call(resolver, 'projectId')) {
      return mark('未匹配', 'neutral', projectReason || '本轮未匹配到项目')
    }
    return result
  }

  if (item.agent === 'memory_agent' && action === 'candidate_ready') {
    const candidates = count(item.candidateCount)
    return mark(candidates === 0 ? '暂无候选' : '候选已就绪', 'neutral', candidates === undefined
      ? '候选记忆已整理，后续写入结果未包含在本轮记录中'
      : candidates === 0
        ? '响应时没有候选记忆；后续处理结果未记录'
        : `整理出 ${candidates} 条候选记忆；后续写入结果未记录`)
  }
  if (item.agent === 'memory_agent' && action === 'write') {
    if (['completed', 'succeeded', 'success'].includes(status)) {
      return mark('已写入', 'success', reason || '记忆写入已完成，具体条目未记录')
    }
    return mark('已发起', 'neutral', '已发起记忆写入，完成结果未记录')
  }

  const parts: string[] = []
  const addCount = (value: unknown, label: string, unit: string) => {
    const number = count(value)
    if (number !== undefined) parts.push(`${label} ${number} ${unit}`)
  }
  switch (item.agent) {
    case 'supervisor_agent': {
      const next = names(item.nextAgents)
      if (next.length) parts.push(`本轮安排：${next.join('、')}`)
      break
    }
    case 'memory_agent': {
      const memory = item.memorySummary
      addCount(memory?.retrievedCount, '合并召回', '条')
      addCount(memory?.structuredCount, '结构化记忆', '条')
      addCount(memory?.semanticCount, '语义记忆', '条')
      addCount(memory?.shortTermCount, '近期对话', '条')
      addCount(memory?.summaryChars, '长期摘要', '字')
      if (!parts.length) addCount(item.memoryContextChars, '记忆上下文', '字')
      break
    }
    case 'rag_agent':
      addCount(item.queryCount, '检索', '次')
      addCount(item.contextCount, '命中文档片段', '段')
      if (item.sufficient === false) parts.push('当前资料不足')
      break
    case 'tool_agent': {
      if (imageTool) {
        addCount(item.imageCount, item.tool === 'image_analyze' ? '输入图片' : '图片数量', '张')
        parts.push('处理已返回，具体结果请查看工具详情')
        break
      }
      addCount(item.toolCount, '工具结果', '个')
      if (!parts.length && Array.isArray(item.selectedTools) && item.selectedTools.length) {
        parts.push(`已选择 ${item.selectedTools.length} 个工具，执行结果请查看工具详情`)
      }
      if (!parts.length && text(item.tool)) parts.push('工具处理已返回，成功状态请查看工具详情')
      break
    }
    case 'gather_agent': {
      const received = names(item.receivedAgents)
      if (received.length) parts.push(`已汇集：${received.join('、')}`)
      break
    }
    case 'writer_agent':
      addCount(item.answerChars, '回答', '字')
      addCount(item.writerInput?.combinedContextChars, '使用上下文', '字')
      if (count(item.rewriteAttempt) !== undefined && Number(item.rewriteAttempt) > 0) {
        parts.push(`第 ${Number(item.rewriteAttempt)} 次修订`)
      }
      break
    case 'reviewer_agent':
      if (item.approved === true) return mark('已通过', 'success', reviewReason || '回答已通过质量检查')
      break
  }
  if (parts.length) {
    const unconfirmedToolResult = item.agent === 'tool_agent' && !['completed', 'succeeded', 'success'].includes(status)
    const label = unconfirmedToolResult ? '已返回' : '已完成'
    // A trace count proves tool results exist, not that every tool succeeded.
    return mark(label, unconfirmedToolResult ? 'neutral' : 'success', parts.join(' · '))
  }
  if (['completed', 'succeeded', 'success'].includes(status)) {
    return mark('已完成', 'success', reason || `${result.purpose}的步骤已完成，具体结果未保存`)
  }
  if (reason) result.summary = reason
  return result
}
