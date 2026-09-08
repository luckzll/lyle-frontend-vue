import { describe, expect, it } from 'vitest'
import { memoryReasonLabel, memoryTargetKey, setCandidateTargetKey, memorySchemaLabel } from '@/domain/memory-presentation'
import { sanitizeUsedMemories } from '@/domain/chat-safety'
import type { MemoryItem } from '@/api/types'

describe('memory confirmation and recall explanation', () => {
  it('distinguishes unpublished builds, previous valid versions and failures', () => {
    const schema = { status: 'pending' as const, version: 0, slotCount: 0, engine: '', errorCode: '' }
    expect(memorySchemaLabel(schema)).toContain('完成后才会用于长期记忆召回')
    expect(memorySchemaLabel({ ...schema, version: 2 })).toContain('第 2 版中仍有效的字段')
    expect(memorySchemaLabel({ ...schema, status: 'failed' })).toContain('整理失败')
    expect(memorySchemaLabel({ ...schema, status: 'ready', version: 1, slotCount: 3 })).toContain('3 个槽位')
    expect(memorySchemaLabel({ ...schema, enabled: false })).toContain('兼容记忆模式')
    expect(memorySchemaLabel({ ...schema, factsEnabled: true })).toContain('核心画像仍按当前确认事实提供')
    expect(memoryReasonLabel('CORE_PROFILE')).toBe('本轮使用的精简核心画像')
  })
  it('submits the edited canonical category instead of silently reverting it', () => {
    const item: MemoryItem = { key: 'pending:one:preference', targetKey: 'preference', schemaPath: 'preferences.general.likes', value: '简短' }
    setCandidateTargetKey(item, ' preferences.output_style ')
    expect(memoryTargetKey(item)).toBe('preferences.output_style')
    expect(item.targetKey).toBe('preferences.output_style')
  })

  it('supports old candidates without schemaPath', () => {
    expect(memoryTargetKey({ key: 'pending:one:career' })).toBe('career')
    expect(memoryTargetKey({ targetKey: 'name' })).toBe('name')
  })

  it('keeps an intentionally cleared type empty so confirmation stays disabled', () => {
    const item: MemoryItem = { key: 'pending:one:career', schemaPath: 'work.current_role' }
    setCandidateTargetKey(item, '')
    expect(memoryTargetKey(item)).toBe('')
  })

  it('preserves and explains the fixed constraint reason after safety sanitization', () => {
    const memories = sanitizeUsedMemories([{ memoryId: 'profile:1', title: '互动边界', valueSummary: '不要追问家庭', reasonCode: 'ACTION_CONSTRAINT', reliability: 'RELIABLE', sourceCount: 1 }])
    expect(memories[0].reasonCode).toBe('ACTION_CONSTRAINT')
    expect(memoryReasonLabel(memories[0].reasonCode)).toBe('遵循你已确认的沟通偏好或互动边界')
    expect(memoryReasonLabel('UNKNOWN')).toBe('与你的问题相关')
  })
})
