import { describe, expect, it } from 'vitest'
import { executionDocument } from '../../src/domain/execution-document'

describe('execution report export', () => {
  it('retains partial status, risks and scope rather than describing a partial run as complete', () => {
    const text = executionDocument({ id: 1, sourceType: 'automation', sourceId: '2', status: 'partial', title: '每周复盘',
      conclusion: '部分资料未读取', completedItems: ['汇总已知进展'], risks: ['缺少本周工时'],
      recommendedActions: [{ type: 'view', label: '补充工时记录' }], dataScope: ['当前项目'], createdAt: '2026-10-14T09:00:00+08:00' })
    expect(text).toContain('状态：部分完成'); expect(text).toContain('缺少本周工时')
    expect(text).toContain('当前项目'); expect(text).toContain('补充工时记录')
  })
})
