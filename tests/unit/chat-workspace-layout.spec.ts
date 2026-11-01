import { describe, expect, it } from 'vitest'
import { clampWorkspaceWidth } from '@/domain/chat-workspace-layout'

describe('chat workspace divider bounds', () => {
  it('keeps the document and conversation readable while dragging', () => {
    expect(clampWorkspaceWidth(150, 1400)).toBe(400)
    expect(clampWorkspaceWidth(1300, 1400)).toBe(1040)
    expect(clampWorkspaceWidth(750, 1400)).toBe(750)
  })
  it('adapts to a narrower workspace without overflowing the container', () => {
    expect(clampWorkspaceWidth(900, 800)).toBe(440)
    expect(clampWorkspaceWidth(900, 600)).toBe(300)
    expect(clampWorkspaceWidth(900, 0)).toBe(0)
    expect(clampWorkspaceWidth(NaN, 1000)).toBe(520)
  })
})
