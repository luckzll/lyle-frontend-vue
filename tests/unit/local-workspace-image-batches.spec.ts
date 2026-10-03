import { describe, expect, it } from 'vitest'
import { LocalWorkspaceImageBatches } from '@/domain/local-workspace-image-batches'
import type { WorkspaceCall, WorkspaceMessage } from '@/domain/local-workspace'

const read = (path: string, id = path): WorkspaceCall => ({ id, name: 'workspace_read', args: { path, offset: 0 } })
const tool = (name: string, id: string, path = ''): WorkspaceCall => ({ id, name, args: { path } })
const result = (calls: WorkspaceCall[] = [], content = '下一步操作'): WorkspaceMessage => ({ role: 'assistant', content, tool_calls: calls })
const paths = (message: WorkspaceMessage) => message.tool_calls!.map(call => call.args.path)
function appendHistory(history: WorkspaceMessage[], message: WorkspaceMessage) {
  history.push(message)
  for (const call of message.tool_calls || []) history.push({ role: 'tool', tool_call_id: call.id, content: '{}' })
}

describe('turn-scoped deterministic image read batches', () => {
  it.each([4, 6, 8])('drains %i original image reads in ordered batches before accepting a final response', count => {
    const batching = new LocalWorkspaceImageBatches()
    const requests = Array.from({ length: count }, (_, index) => read(`images/${index}.png`, `image-${index}`))
    const history: WorkspaceMessage[] = [{ role: 'user', content: '请读取所有这些图片' }]
    let prepared = batching.prepare(result(requests), history)
    expect(paths(prepared)).toEqual(requests.slice(0, 2).map(call => call.args.path))
    expect(batching.pendingCount).toBe(count - 2)
    const all: WorkspaceCall[] = []
    for (let batch = 0; batch < count / 2; batch++) {
      expect(prepared.tool_calls).toHaveLength(2)
      all.push(...prepared.tool_calls!)
      appendHistory(history, prepared)
      prepared = batching.prepare(result([], '模型尝试给出最终答案'), history)
    }
    expect(prepared.tool_calls).toEqual([])
    expect(batching.pendingCount).toBe(0)
    expect(all.map(call => call.args.path)).toEqual(requests.map(call => call.args.path))
    expect(all.map(call => call.id)).toEqual(requests.map(call => call.id))
    expect(new Set(all.map(call => call.id)).size).toBe(count)
  })

  it('does not mark a premature model final as complete while original reads remain queued', () => {
    const batching = new LocalWorkspaceImageBatches()
    batching.prepare(result(['a.png', 'b.png', 'c.png', 'd.png'].map(path => read(path))))
    const continuing = batching.prepare(result([], '前两张图片的可见内容'))
    expect(paths(continuing)).toEqual(['c.png', 'd.png'])
    expect(continuing.content).toContain('自动继续原任务')
    expect(continuing.content).toContain('尚未完成')
    expect(continuing.content).not.toContain('已读取')
    expect(batching.prepare(result([], '四张实际读取后返回最终结果')).tool_calls).toEqual([])
  })

  it('preserves the original mixed prefix and queues only image reads, never deferred writes/list/source/document reads', () => {
    const batching = new LocalWorkspaceImageBatches()
    const requests = [tool('workspace_list', 'list'), read('src/main.ts', 'text'), read('a.png'), read('b.jpeg'),
      read('c.webp'), tool('workspace_edit', 'write', 'src/main.ts'), read('report.pdf', 'document'), read('d.PNG')]
    const first = batching.prepare(result(requests))
    expect(first.tool_calls!.map(call => call.id)).toEqual(['list', 'text', 'a.png', 'b.jpeg'])
    expect(batching.pendingPaths).toEqual(['c.webp', 'd.PNG'])
    expect(first.content).toContain('其他工具请求尚未执行')
    expect(first.content).toContain('不会自动重放')
    const second = batching.prepare(result())
    expect(paths(second)).toEqual(['c.webp', 'd.PNG'])
    expect(second.tool_calls!.every(call => call.name === 'workspace_read')).toBe(true)
    expect(batching.prepare(result()).tool_calls).toEqual([])
  })

  it('keeps newly requested model actions first and deduplicates their scheduled paths against the pending queue', () => {
    const batching = new LocalWorkspaceImageBatches()
    batching.prepare(result(['a.png', 'b.png', 'c.png', 'd.png'].map(path => read(path))))
    const next = batching.prepare(result([tool('workspace_list', 'new-list'), read('c.png', 'new-c')]))
    expect(next.tool_calls!.map(call => call.id)).toEqual(['new-list', 'new-c'])
    expect(batching.pendingPaths).toEqual(['d.png'])
    expect(paths(batching.prepare(result()))).toEqual(['d.png'])
  })

  it('deduplicates pending paths when subsequent model requests overlap both a scheduled prefix and a deferred suffix', () => {
    const batching = new LocalWorkspaceImageBatches()
    batching.prepare(result(['a.png', 'b.png', 'c.png', 'd.png'].map(path => read(path))))
    const next = batching.prepare(result([read('c.png', 'new-c'), read('e.png'), read('d.png', 'new-d'), read('f.png')]))
    expect(paths(next)).toEqual(['c.png', 'e.png'])
    expect(batching.pendingPaths).toEqual(['d.png', 'f.png'])
    const continuation = batching.prepare(result())
    expect(paths(continuation)).toEqual(['d.png', 'f.png'])
    expect(continuation.tool_calls![0]!.id).toBe('d.png')
    expect(batching.pendingCount).toBe(0)
  })

  it('does not enqueue duplicate suffix paths or paths already scheduled in the same batch', () => {
    const batching = new LocalWorkspaceImageBatches()
    const prepared = batching.prepare(result([read('a.png', 'a1'), read('b.png', 'b1'), read('a.png', 'a2'),
      read('c.png', 'c1'), read('c.png', 'c2')]))
    expect(paths(prepared)).toEqual(['a.png', 'b.png'])
    expect(batching.pendingPaths).toEqual(['c.png'])
    expect(paths(batching.prepare(result()))).toEqual(['c.png'])
  })

  it('does not report zero pending pictures when a duplicate-only suffix is removed', () => {
    const batching = new LocalWorkspaceImageBatches()
    const prepared = batching.prepare(result([read('a.png', 'a1'), read('b.png', 'b1'), read('a.png', 'a2'), read('b.png', 'b2')]))
    expect(batching.pendingCount).toBe(0)
    expect(prepared.content).toContain('重复图片请求不会再次排队')
    expect(prepared.content).not.toContain('0 张尚未读取')
  })

  it('gives newly emitted tools unique safe IDs if the model reuses an ID from earlier conversation history', () => {
    const batching = new LocalWorkspaceImageBatches()
    const history: WorkspaceMessage[] = [{ role: 'assistant', content: '', tool_calls: [read('old.png', 'used')] },
      { role: 'tool', tool_call_id: 'used', content: '{}' }]
    const source = result([read('new.png', 'used'), read('other.jpg', 'fresh')])
    const prepared = batching.prepare(source, history)
    expect(prepared.tool_calls![0]!.id).toMatch(/^image-batch-[a-zA-Z0-9-]+$/)
    expect(prepared.tool_calls![0]!.id.length).toBeLessThanOrEqual(128)
    expect(prepared.tool_calls![0]!.id).not.toBe('used')
    expect(prepared.tool_calls![1]!.id).toBe('fresh')
    expect(source.tool_calls![0]!.id).toBe('used')
  })

  it('remaps upstream-valid long IDs into identifiers that local history can save', () => {
    const batching = new LocalWorkspaceImageBatches()
    const source = result([read('a.png', 'a'.repeat(129)), read('b.png', 'b'.repeat(128)),
      read('c.png', 'c'.repeat(150))])
    const first = batching.prepare(source)
    expect(first.tool_calls![0]!.id).toMatch(/^image-batch-/)
    expect(first.tool_calls![0]!.id.length).toBeLessThanOrEqual(128)
    expect(first.tool_calls![1]!.id).toBe('b'.repeat(128))
    const continuation = batching.prepare(result())
    expect(continuation.tool_calls![0]!.id).toMatch(/^image-batch-/)
    expect(continuation.tool_calls![0]!.id.length).toBeLessThanOrEqual(128)
    expect(source.tool_calls![0]!.id).toHaveLength(129)
    expect(source.tool_calls![2]!.id).toHaveLength(150)
  })

  it('renames an original queued ID if a newer model operation consumes that ID first', () => {
    const batching = new LocalWorkspaceImageBatches()
    batching.prepare(result([read('a.png', 'a'), read('b.png', 'b'), read('c.png', 'c'), read('d.png', 'd')]))
    const other = batching.prepare(result([tool('workspace_list', 'c')]))
    expect(other.tool_calls![0]!.id).toBe('c')
    const continuation = batching.prepare(result())
    expect(paths(continuation)).toEqual(['c.png', 'd.png'])
    expect(continuation.tool_calls![0]!.id).not.toBe('c')
    expect(continuation.tool_calls![0]!.id).toMatch(/^image-batch-/)
    expect(continuation.tool_calls![1]!.id).toBe('d')
  })

  it('rejects duplicate IDs within a model result before changing the pending queue', () => {
    const batching = new LocalWorkspaceImageBatches()
    batching.prepare(result(['a.png', 'b.png', 'c.png', 'd.png'].map(path => read(path))))
    expect(() => batching.prepare(result([read('x.png', 'same'), read('y.png', 'same')]))).toThrow('重复')
    expect(batching.pendingPaths).toEqual(['c.png', 'd.png'])
  })

  it('snapshots original calls and never mutates the source result or exposes mutable queued arguments', () => {
    const batching = new LocalWorkspaceImageBatches()
    const source = result(['a.png', 'b.png', 'c.png', 'd.png'].map(path => read(path)), '原始说明')
    const snapshot = structuredClone(source)
    const prepared = batching.prepare(source)
    expect(source).toEqual(snapshot)
    prepared.tool_calls![0]!.args.path = 'mutated-prefix.png'
    source.tool_calls![2]!.args.path = 'mutated-source.png'
    const exposed = batching.pendingPaths; exposed[0] = 'mutated-path-array.png'
    expect(paths(batching.prepare(result()))).toEqual(['c.png', 'd.png'])
    expect(source.tool_calls![0]!.args.path).toBe('a.png')
  })

  it('isolates queues by turn and discards all deferred reads when a turn is cancelled', () => {
    const first = new LocalWorkspaceImageBatches(); const second = new LocalWorkspaceImageBatches()
    const requests = result(['a.png', 'b.png', 'c.png', 'd.png'].map(path => read(path)))
    first.prepare(requests); second.prepare(requests)
    first.cancel()
    expect(first.pendingCount).toBe(0)
    expect(() => first.prepare(result())).toThrow('已停止')
    expect(second.pendingPaths).toEqual(['c.png', 'd.png'])
    expect(paths(second.prepare(result()))).toEqual(['c.png', 'd.png'])
    expect(new LocalWorkspaceImageBatches().prepare(result()).tool_calls).toEqual([])
  })
})
