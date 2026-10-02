import { describe, expect, it } from 'vitest'
import { compactWorkspaceImageHistory } from '@/domain/local-workspace-images'
import type { WorkspaceMessage } from '@/domain/local-workspace'

describe('bounded image context across directory batches', () => {
  const bytes = (messages: WorkspaceMessage[]) => new TextEncoder().encode(JSON.stringify(messages)).length
  it('preserves small histories and never mutates saved image messages', () => {
    const history: WorkspaceMessage[] = [{ role: 'user', content: 'first picture', images: ['a'.repeat(50)] }, { role: 'assistant', content: 'Visible purple rectangle' }]
    const compact = compactWorkspaceImageHistory(history)
    expect(compact).toEqual(history)
    expect(compact).not.toBe(history)
  })
  it('releases only already processed older pictures while retaining path/result/tool order and the pending batch', () => {
    const oldPictures = ['a'.repeat(4000)]
    const pendingPictures = ['b'.repeat(4000)]
    const history: WorkspaceMessage[] = [
      { role: 'user', content: 'Read these folder pictures' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'read-a', name: 'workspace_read', args: { path: 'a.png' } }] },
      { role: 'tool', content: '{"kind":"image","path":"a.png","status":"read"}', tool_call_id: 'read-a' },
      { role: 'user', content: '1. a.png', images: oldPictures },
      { role: 'assistant', content: 'a.png shows a purple rectangle.', tool_calls: [{ id: 'read-b', name: 'workspace_read', args: { path: 'b.png' } }] },
      { role: 'tool', content: '{"kind":"image","path":"b.png","status":"read"}', tool_call_id: 'read-b' },
      { role: 'user', content: '1. b.png', images: pendingPictures },
    ]
    const compact = compactWorkspaceImageHistory(history, 6500)
    expect(bytes(compact)).toBeLessThan(6500)
    expect(compact).toHaveLength(history.length)
    expect(compact.map(message => message.role)).toEqual(history.map(message => message.role))
    expect(compact[3]).toMatchObject({ images: [], content: expect.stringContaining('a.png') })
    expect(compact[3]!.content).toContain('重新调用 workspace_read')
    expect(compact[4]).toEqual(history[4])
    expect(compact[6]!.images).toEqual(pendingPictures)
    expect(history[3]!.images).toEqual(oldPictures)
    expect(compact[2]!.tool_call_id).toBe('read-a')
    expect(compact[5]!.tool_call_id).toBe('read-b')
  })
  it('retains unprocessed pixels even when text alone exceeds the budget so the caller can stop clearly', () => {
    const history: WorkspaceMessage[] = [{ role: 'user', content: 'x'.repeat(7000), images: ['b'.repeat(4000)] }]
    const compact = compactWorkspaceImageHistory(history, 6500)
    expect(compact).toEqual(history)
    expect(bytes(compact)).toBeGreaterThan(6500)
  })
  it('does not prune every image unnecessarily or append the explanation repeatedly', () => {
    const history: WorkspaceMessage[] = [
      { role: 'user', content: 'a.png', images: ['a'.repeat(4000)] }, { role: 'assistant', content: 'A result' },
      { role: 'user', content: 'b.png', images: ['b'.repeat(4000)] }, { role: 'assistant', content: 'B result' },
      { role: 'user', content: 'c.png', images: ['c'.repeat(4000)] },
    ]
    const compact = compactWorkspaceImageHistory(history, 10_000)
    expect(compact[0]!.images).toEqual([])
    expect(compact[2]!.images).toEqual(history[2]!.images)
    expect(compact[4]!.images).toEqual(history[4]!.images)
    expect(compactWorkspaceImageHistory(compact, 10_000)).toEqual(compact)
  })
})
