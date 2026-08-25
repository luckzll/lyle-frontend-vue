import { describe, expect, it } from 'vitest'
import { formatAutomationSchedule, formatAutomationTemplateCategory, formatAutomationTrigger } from '@/domain/automation-schedule'
import { formatBeijingTimeShort, humanizeIsoDateTimes, parseServerDateTime } from '@/domain/date-time'
import { formatSourceReference } from '@/domain/source-reference'

describe('presentation formatters', () => {
  it('turns automation expressions into user-facing Chinese schedules', () => {
    expect(formatAutomationSchedule('daily:10:00', 'Asia/Shanghai')).toBe('每天 10:00（北京时间）')
    expect(formatAutomationSchedule('weekly:fri:17:00', 'Asia/Shanghai')).toBe('每周五 17:00（北京时间）')
    expect(formatAutomationTrigger('task_due', null, 'Asia/Shanghai')).toBe('任务到期时运行')
  })

  it('turns automation template categories into user-facing Chinese labels', () => {
    expect(formatAutomationTemplateCategory('project')).toBe('项目')
    expect(formatAutomationTemplateCategory('code')).toBe('代码')
    expect(formatAutomationTemplateCategory('document')).toBe('文档')
    expect(formatAutomationTemplateCategory('internal_category')).toBe('通用')
  })

  it('hides opaque source identifiers from default task copy', () => {
    expect(formatSourceReference('conversation:conversation-123')).toBe('由对话生成')
    expect(formatSourceReference('automation:17')).toBe('由自动化生成')
    expect(formatSourceReference('custom-source:opaque-id')).toBe('由 Lyle 生成')
  })

  it('replaces embedded ISO timestamps with Beijing time copy', () => {
    const result = humanizeIsoDateTimes('计划于 2026-07-05T01:00:00+00:00 执行')
    expect(result).toContain('北京时间')
    expect(result).not.toContain('2026-07-05T01:00:00+00:00')
  })

  it('treats offset-less server timestamps as UTC', () => {
    expect(parseServerDateTime('2026-08-25T02:34:03')?.toISOString()).toBe('2026-08-25T02:34:03.000Z')
    expect(formatBeijingTimeShort('2026-08-25T02:34:03')).toBe('08/25 10:34')
  })
})
