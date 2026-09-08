import type { MemoryItem } from '@/api/types'
import type { MemorySchemaStatus } from '@/api/types'

export function memorySchemaLabel(schema: MemorySchemaStatus): string {
  if (schema.enabled === false) return '当前使用兼容记忆模式'
  const previous = schema.factsEnabled ? '；核心画像仍按当前确认事实提供，详细记忆等待整理' : schema.version > 0 ? `；沿用第 ${schema.version} 版中仍有效的字段` : '；完成后才会用于长期记忆召回'
  if (schema.status === 'ready') return `记忆已整理 · 第 ${schema.version} 版 · ${schema.slotCount} 个槽位`
  if (schema.status === 'failed') return `记忆整理失败${previous}`
  if (schema.status === 'missing') return '尚未整理记忆，首次召回时会自动开始'
  return `记忆正在整理${previous}`
}

export function memoryReasonLabel(reason: string): string {
  return ({
    QUESTION_RELEVANT: '与你的问题直接相关',
    CORE_PROFILE: '本轮使用的精简核心画像',
    USER_REQUESTED_RECALL: '你明确要求回忆',
    PROJECT_CONTEXT: '当前项目上下文需要',
    ACTION_CONSTRAINT: '遵循你已确认的沟通偏好或互动边界'
  } as Record<string, string>)[reason] || '与你的问题相关'
}

export function memoryTargetKey(item: MemoryItem): string {
  const key = item.schemaPath ?? item.targetKey ?? item.key ?? ''
  return key.startsWith('pending:') ? key.split(':').slice(2).join(':') : key
}

export function setCandidateTargetKey(item: MemoryItem, value: string): void {
  // schemaPath is canonical and takes precedence when submitting the form.
  item.schemaPath = value.trim()
  item.targetKey = value.trim()
}
