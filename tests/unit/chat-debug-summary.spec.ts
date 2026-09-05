import { describe, expect, it } from 'vitest'
import { summarizeChatDebug, type ChatDebugSummaryInput } from '@/domain/chat-debug-summary'

const counts = { injectedMemoryCount: 3, sourceCount: 5, toolResultCount: 0 }

describe('compact chat debug summary', () => {
  it('shows saved counts without interpreting zero tool results as no tool calls', () => {
    expect(summarizeChatDebug({ state: 'available', ...counts }))
      .toBe('注入记忆 3 条 · 知识片段 5 个 · 工具结果 0 条')
    expect(summarizeChatDebug({ state: 'available', injectedMemoryCount: 0, sourceCount: 0, toolResultCount: 0 }))
      .toBe('注入记忆 0 条 · 知识片段 0 个 · 工具结果 0 条')
  })

  it.each([
    ['pending', '正在采集，等待本轮调试快照'],
    ['legacy', '历史回答未保存调试明细'],
    ['unsupported', '调试快照版本暂不支持'],
    ['unavailable', '本轮调试快照未返回'],
    [undefined, '调试快照状态未记录']
  ] as const)('does not expose misleading counts while state is %s', (state, expected) => {
    expect(summarizeChatDebug({ state, ...counts })).toBe(expected)
  })

  it('marks truncated evidence instead of implying every detail was saved', () => {
    expect(summarizeChatDebug({ state: 'available', truncated: true, ...counts }))
      .toBe('部分明细已截断 · 注入记忆 3 条 · 知识片段 5 个 · 工具结果 0 条')
  })

  it.each([
    [{ answerFailed: true }, '回答未完成'],
    [{ reviewBlocked: true }, '审核未通过'],
    [{ failedToolCount: 2 }, '2 条工具结果失败']
  ] satisfies Array<[Partial<ChatDebugSummaryInput>, string]>)('keeps execution problems visible alongside a complete snapshot: %j', (failure, prefix) => {
    expect(summarizeChatDebug({ state: 'available', ...counts, ...failure }))
      .toBe(`${prefix} · 注入记忆 3 条 · 知识片段 5 个 · 工具结果 0 条`)
  })

  it('retains all recorded failure signals without treating the snapshot as successful', () => {
    expect(summarizeChatDebug({
      state: 'available', ...counts, toolResultCount: 3, failedToolCount: 1, reviewBlocked: true, answerFailed: true
    })).toBe('回答未完成 · 审核未通过 · 1 条工具结果失败 · 注入记忆 3 条 · 知识片段 5 个 · 工具结果 3 条')
    expect(summarizeChatDebug({ state: 'unavailable', ...counts, answerFailed: true }))
      .toBe('回答未完成 · 本轮调试快照未返回')
  })

  it('does not manufacture a zero for an invalid recorded count or an invalid failure count', () => {
    expect(summarizeChatDebug({ state: 'available', ...counts, sourceCount: NaN, failedToolCount: -1 }))
      .toBe('注入记忆 3 条 · 知识片段数量未记录 · 工具结果 0 条')
  })
})
