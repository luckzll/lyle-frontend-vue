import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
vi.mock('@/auth', () => ({ getAuthToken: () => 'test-only' }))
vi.mock('@/api/local-workspace-documents', () => ({ extractWorkspaceDocument: vi.fn() }))
import { useDocumentWorkspace } from '../../src/composables/useDocumentWorkspace'
import { extractWorkspaceDocument } from '../../src/api/local-workspace-documents'

afterEach(() => { vi.restoreAllMocks() })
function workspace() {
  const id = ref(''); const owner = ref('account-a'); const scope = effectScope()
  // The composable's cleanup is tested by its returned abort signals below.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const state = scope.run(() => useDocumentWorkspace(id, owner))!
  return { id, owner, scope, ...state }
}
describe('document scope and asynchronous reads', () => {
  it('isolates conversations and clears all private drafts when the account changes', () => {
    const w = workspace(); w.add('新对话草稿', 'A'); w.id.value = 'existing'
    expect(w.drafts.value).toHaveLength(0)
    w.add('现有对话草稿', 'B'); w.id.value = ''
    expect(w.drafts.value[0]?.content).toBe('新对话草稿')
    w.owner.value = 'account-b'; expect(w.drafts.value).toHaveLength(0)
    w.id.value = 'existing'; expect(w.drafts.value).toHaveLength(0)
    w.scope.stop()
  })
  it('promotes a new draft only when the chat explicitly creates its conversation', () => {
    const w = workspace(); w.add('新对话正文', 'A'); w.promote('created'); w.id.value = 'created'
    expect(w.drafts.value[0]?.content).toBe('新对话正文')
    w.id.value = ''; expect(w.drafts.value).toHaveLength(0); w.scope.stop()
  })
  it('aborts a read on navigation and ignores a late parser response', async () => {
    const w = workspace(); let resolve!: (data: any) => void
    vi.mocked(extractWorkspaceDocument).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = w.read(new File(['test'], 'example.docx'))
    expect(w.busy.value).toBe(true)
    const signal = vi.mocked(extractWorkspaceDocument).mock.calls.at(-1)![1]
    w.id.value = 'another'; expect(signal.aborted).toBe(true)
    resolve({ text: '属于旧对话的正文', format: 'docx', truncated: false, warnings: [] }); await pending
    expect(w.drafts.value).toHaveLength(0); expect(w.busy.value).toBe(false); w.scope.stop()
  })
})
