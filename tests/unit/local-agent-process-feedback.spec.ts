import { describe, expect, it } from 'vitest'
import { localActivityDisplayStatus, localActivityFeedback, localReadFeedback } from '@/domain/local-agent-process'
import type { LocalActivity } from '@/domain/local-workspace-history'

describe('local activity presentation', () => {
  it.each(['修改文件', '新建文件'])('presents a refused %s as unexecuted without changing its saved status', label => {
    const activity: LocalActivity = { label, status: 'done', detail: ' 已拒绝，文件未修改 ' }
    const before = { ...activity }
    expect(localActivityDisplayStatus(activity, false)).toBe('rejected')
    expect(localActivityFeedback(activity, 'rejected')).toContain('已拒绝，文件未修改')
    expect(localActivityFeedback(activity, 'rejected')).not.toMatch(/写入成功|已完成|成功创建/)
    expect(activity).toEqual(before)
  })

  it.each([
    { label: '分析下一步', status: 'done', detail: '已拒绝，文件未修改' },
    { label: '修改文件', status: 'running', detail: '已拒绝，文件未修改' },
    { label: '修改文件', status: 'done', detail: '用户说：已拒绝，文件未修改' },
    { label: '新建文件', status: 'done', detail: '已确认写入，并复核文件内容' },
  ] satisfies LocalActivity[])('does not infer refusal from unrelated commentary or unfinished steps', activity => {
    expect(localActivityDisplayStatus(activity, true)).toBe(activity.status)
  })

  it.each(['running', 'waiting'] as const)('presents an inactive %s step as interrupted without success text', status => {
    const activity: LocalActivity = { label: '修改文件', status, detail: '正在检查修改范围。' }
    expect(localActivityDisplayStatus(activity, true)).toBe(status)
    expect(localActivityDisplayStatus(activity, false)).toBe('interrupted')
    expect(localActivityFeedback(activity, 'interrupted')).toBe('本轮已停止，此步骤未完成。\n正在检查修改范围。')
    expect(localActivityFeedback(activity, 'interrupted')).not.toMatch(/写入成功|已完成|已写入/)
    expect(activity.status).toBe(status)
  })

  it('distinguishes an explicit stopped event from a real error', () => {
    expect(localActivityDisplayStatus({ label: '任务已停止，已完成的文件修改保留。', status: 'error' }, false)).toBe('interrupted')
    const error: LocalActivity = { label: '读取文件', status: 'error', detail: '文件超过 1 MB 读取限制' }
    expect(localActivityDisplayStatus(error, false)).toBe('error')
    expect(localActivityFeedback(error, 'error')).toBe('此步骤未能完成。\n文件超过 1 MB 读取限制')
  })

  it('clarifies a restored error before its original ongoing commentary', () => {
    const activity: LocalActivity = { label: '分析下一步', status: 'error', detail: '正在整理已读取的上下文。' }
    expect(localActivityDisplayStatus(activity, false)).toBe('error')
    expect(localActivityFeedback(activity, 'error')).toBe('此步骤未能完成。\n正在整理已读取的上下文。')
  })

  it('retains real commentary and real write feedback verbatim', () => {
    const commentary = '先查看入口文件。\n接着核对相关调用。'
    expect(localActivityFeedback({ label: '分析下一步', status: 'running', detail: commentary }, 'running')).toBe(commentary)
    expect(localActivityFeedback({ label: '分析下一步', status: 'done', detail: commentary }, 'done')).toBe(commentary)
    const detail = '已确认写入，并复核文件内容'
    expect(localActivityFeedback({ label: '修改文件', status: 'done', detail }, 'done')).toBe(detail)
  })

  it('makes pending approval and missing write outcomes explicit', () => {
    expect(localActivityFeedback({ label: '新建文件', status: 'waiting' }, 'waiting')).toContain('文件尚未写入')
    for (const label of ['修改文件', '新建文件']) {
      const text = localActivityFeedback({ label, status: 'done', detail: '  ' }, 'done')
      expect(text).toContain('未提供写入结果详情')
      expect(text).not.toMatch(/写入成功|已完成|成功创建/)
    }
  })

  it.each(['分析下一步', '查看目录', '读取文件', '搜索项目', '修改文件', '新建文件'])('provides neutral fallback text for %s', label => {
    expect(localActivityFeedback({ label, status: 'running' }, 'running')).toMatch(/正在/)
    expect(localActivityFeedback({ label, status: 'done' }, 'done')).not.toMatch(/匹配成功|已全部|写入成功|成功创建/)
  })
})

describe('local read result summaries', () => {
  it('reports an image read without claiming the model has already identified its contents', () => {
    const feedback = localReadFeedback('workspace_read', { kind: 'image', path: 'screenshots/a.png', image: 'data:image/jpeg;base64,/9j/2Q==' })
    expect(feedback).toContain('已读取并压缩图片')
    expect(feedback).toContain('接下来交给模型识别')
    expect(feedback).not.toContain('data:image')
    expect(feedback).not.toContain('已识别')
  })
  it('reports zero directory items and zero matches without claiming a complete scan', () => {
    expect(localReadFeedback('workspace_list', { entries: [], nextOffset: null, scanCapped: false })).toBe('本次返回 0 个目录项。')
    expect(localReadFeedback('workspace_search', { matches: [], truncated: false, skipped: 0 })).toBe('本次返回 0 条匹配。')
  })

  it('reports only the returned directory page and its scan limit', () => {
    const text = localReadFeedback('workspace_list', { entries: [{ name: 'src', path: 'src', kind: 'directory' }], nextOffset: 100, scanCapped: true })
    expect(text).toContain('本次返回 1 个目录项')
    expect(text).toContain('继续分页')
    expect(text).toContain('扫描上限')
    expect(text).toContain('可能不完整')
    expect(text).not.toMatch(/全部目录|完整目录/)
  })

  it('reports the actual returned character count separately from the file total', () => {
    const text = localReadFeedback('workspace_read', { path: 'src/a.ts', content: '代码🚀', offset: 0, nextOffset: 4, totalChars: 20000 })
    expect(text).toContain('本次返回 4 个字符')
    expect(text).toContain('文件共 20000 个字符')
    expect(text).toContain('后续内容可继续读取')
    expect(text).not.toMatch(/全文|全部读取|完整读取/)
  })

  it('handles an empty read and a final partial page without inventing full-file coverage', () => {
    expect(localReadFeedback('workspace_read', { content: '', totalChars: 0, nextOffset: null })).toBe('本次返回 0 个字符（文件共 0 个字符）。')
    const text = localReadFeedback('workspace_read', { content: 'tail', offset: 12000, totalChars: 12004, nextOffset: null })
    expect(text).toContain('本次返回 4 个字符')
    expect(text).not.toMatch(/继续读取|全文|全部读取/)
  })

  it('keeps zero-match search limitations and skipped files visible', () => {
    const text = localReadFeedback('workspace_search', { matches: [], truncated: true, skipped: 3 })
    expect(text).toContain('本次返回 0 条匹配')
    expect(text).toContain('结果可能不完整')
    expect(text).toContain('3 个文件未能读取，已跳过')
    expect(text).not.toMatch(/没有匹配|未找到|全部搜索/)
  })

  it('counts only actual matches and ignores invalid optional numbers', () => {
    const text = localReadFeedback('workspace_search', { matches: [{ path: 'src/a.ts', line: 2, text: 'const answer = 42' }], truncated: false, skipped: -1 })
    expect(text).toBe('本次返回 1 条匹配。')
    expect(localReadFeedback('workspace_read', { content: 'abc', nextOffset: '3', totalChars: 2 })).toBe('本次返回 3 个字符。')
  })

  it.each([
    ['workspace_list', null],
    ['workspace_list', { entries: 'not an array' }],
    ['workspace_list', { entries: [123] }],
    ['workspace_read', { content: 123 }],
    ['workspace_search', { matches: [{ path: 'a.ts', line: 0, text: 'x' }] }],
    ['workspace_search', { status: 'error', message: 'failed' }],
    ['unknown_tool', { content: 'unexpected' }],
  ])('does not turn an unknown or malformed %s outcome into a success claim', (name, result) => {
    expect(localReadFeedback(name as string, result)).toBe('此步骤未提供可展示的结果摘要。')
  })
})
