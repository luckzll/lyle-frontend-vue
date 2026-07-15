import { describe, expect, it } from 'vitest'
import { statusPresentation } from '@/domain/status'

describe('statusPresentation', () => {
  it.each([
    ['completed', 'success', '已完成'],
    ['awaiting_confirmation', 'warning', '待确认'],
    ['failed', 'danger', '失败'],
    ['paused', 'neutral', '已暂停'],
    ['running', 'info', '执行中']
  ])('maps %s to one shared semantic status', (status, tone, label) => {
    expect(statusPresentation(status)).toEqual({ tone, label })
  })

  it('degrades unknown and empty values without inventing success', () => {
    expect(statusPresentation('custom_state')).toEqual({ tone: 'neutral', label: 'custom_state' })
    expect(statusPresentation()).toEqual({ tone: 'neutral', label: '状态未知' })
  })
})
