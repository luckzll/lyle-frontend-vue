import { describe, expect, it } from 'vitest'
import { MEMORY_CATEGORY_OPTIONS, memoryCategoryLabel, memoryCandidateSourceText, memoryReasonLabel, memoryTargetKey, setCandidateTargetKey, memorySchemaLabel } from '@/domain/memory-presentation'
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

  it('shows readable canonical and legacy categories without changing the submission key', () => {
    const canonical = { key: 'pending:one:preference', targetKey: 'preference', schemaPath: 'preferences.general.likes' }
    expect(memoryCategoryLabel(canonical)).toBe('个人喜好')
    expect(memoryCategoryLabel({ key: 'pending:two:pet_preference' })).toBe('宠物偏好')
    expect(memoryCategoryLabel({ targetKey: 'career' })).toBe('职业')
    expect(memoryCategoryLabel({ schemaPath: 'preferences.visual.dislikes' })).toBe('视觉负向偏好')
    expect(canonical).toEqual({ key: 'pending:one:preference', targetKey: 'preference', schemaPath: 'preferences.general.likes' })
    expect(new Set(MEMORY_CATEGORY_OPTIONS.map(item => item.value)).size).toBe(35)
    expect(MEMORY_CATEGORY_OPTIONS.every(item => /\p{Script=Han}/u.test(item.label))).toBe(true)
  })

  it('uses a safe Chinese fallback label while preserving an unknown schema path', () => {
    const item = { key: 'pending:one:new', schemaPath: 'future.custom.preference', label: '新的偏好' }
    expect(memoryCategoryLabel(item)).toBe('新的偏好')
    expect(memoryTargetKey(item)).toBe('future.custom.preference')
    expect(memoryCategoryLabel({ ...item, label: 'future.custom.preference' })).toBe('个人记忆')
    expect(memoryCategoryLabel({ ...item, label: '偏好 (future.custom.preference)' })).toBe('个人记忆')
    expect(memoryCategoryLabel({ ...item, label: '来源 2112817612362207234' })).toBe('个人记忆')
    expect(memoryCategoryLabel({ ...item, label: '偏好\n额外标签' })).toBe('个人记忆')
    expect(memoryCategoryLabel({ schemaPath: '' })).toBe('个人记忆')
  })

  it('prefers explicit source text and removes references from newline and inline evidence', () => {
    const reference = 'source_ref:conversation:2112817609317142529;message:2112817612362207234'
    expect(memoryCandidateSourceText({ sourceText: '我喜欢猫。', source: `${reference}\n旧内容` })).toBe('我喜欢猫。')
    expect(memoryCandidateSourceText({ source: `${reference}\n我喜欢猫，也喜欢周末去逛展。` })).toBe('我喜欢猫，也喜欢周末去逛展。')
    expect(memoryCandidateSourceText({ source: `${reference} 我喜欢猫。` })).toBe('我喜欢猫。')
    expect(memoryCandidateSourceText({ source: 'conversation:c-1;message:m-1\r\n我喜欢猫。' })).toBe('我喜欢猫。')
    expect(memoryCandidateSourceText({ sourceText: `${reference}\n我喜欢猫。` })).toBe('我喜欢猫。')
    expect(memoryCandidateSourceText({ source: '我喜欢猫。' })).toBe('我喜欢猫。')
  })

  it('falls back cleanly for missing evidence and machine-only source identifiers', () => {
    for (const source of [undefined, '', '  ', 'chat_candidate', 'manual', 'conversation:c-1;message:m-1', 'source_ref:conversation:c-1;message:m-1', 'custom-source:opaque-id', '2112817612362207234', 'd6177936-4637-4a83-8ce3-3540fa5c453d']) {
      expect(memoryCandidateSourceText({ source })).toBe('本轮对话')
    }
    expect(memoryCandidateSourceText({ source: 'conversation:c-1', sourceText: '  ' })).toBe('本轮对话')
    expect(memoryCandidateSourceText({ source: 'chat_candidate', sourceRef: 'source_ref:conversation:c-1\n我喜欢猫。' })).toBe('我喜欢猫。')
  })

  it('preserves and explains the fixed constraint reason after safety sanitization', () => {
    const memories = sanitizeUsedMemories([{ memoryId: 'profile:1', title: '互动边界', valueSummary: '不要追问家庭', reasonCode: 'ACTION_CONSTRAINT', reliability: 'RELIABLE', sourceCount: 1 }])
    expect(memories[0].reasonCode).toBe('ACTION_CONSTRAINT')
    expect(memoryReasonLabel(memories[0].reasonCode)).toBe('遵循你已确认的沟通偏好或互动边界')
    expect(memoryReasonLabel('UNKNOWN')).toBe('与你的问题相关')
  })
})
