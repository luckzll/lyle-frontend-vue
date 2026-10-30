import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { authState } from '@/auth'
import { useToolSelection } from '@/composables/useToolSelection'

vi.mock('@/auth', async () => {
  const { reactive } = await import('vue')
  return { authState: reactive({ user: { id: 42 } }) }
})

const store = new Map<string, string>()
const disconnect = vi.fn(async () => undefined)
let scope = effectScope()

beforeEach(() => {
  store.clear(); disconnect.mockClear(); scope = effectScope(); authState.user!.id = 42
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
  vi.stubGlobal('window', { lyleTools: { disconnect } })
})
afterEach(() => { scope.stop(); vi.unstubAllGlobals() })

describe('project-scoped tool selection', () => {
  it('isolates accounts and projects while retaining each project selection', async () => {
    const project = ref('project-a')
    const tools = scope.run(() => useToolSelection(project))!
    tools.selection.value = { mcpToolIds: [7], workspaceId: 3 }; await nextTick()
    project.value = 'project-b'; await nextTick()
    expect(tools.selection.value.mcpToolIds).toEqual([])
    tools.selection.value = { mcpToolIds: [8] }; await nextTick()
    project.value = 'project-a'; await nextTick()
    expect(tools.selection.value).toEqual({ mcpToolIds: [7], workspaceId: 3 })
    authState.user!.id = 43; await nextTick()
    expect(tools.selection.value.mcpToolIds).toEqual([])
  })

  it('never persists directory capability tokens and revokes old directory grants', async () => {
    const project = ref('project-a')
    const tools = scope.run(() => useToolSelection(project))!
    tools.localWorkspace.value = { token: 'native-token-a', name: 'sample', path: 'C:/sample' }
    tools.selection.value = { mcpToolIds: [], localCli: true }; await nextTick()
    expect([...store.values()].join('')).not.toContain('native-token')
    project.value = 'project-b'; await nextTick()
    expect(disconnect).toHaveBeenCalledWith('native-token-a')
    expect(tools.localWorkspace.value).toBeNull()
    tools.localWorkspace.value = { token: 'native-token-b', name: 'sample', path: 'C:/sample' }; await nextTick()
    scope.stop()
    expect(disconnect).toHaveBeenCalledWith('native-token-b')
  })

  it('restores only bounded positive IDs, without restoring local command authority', () => {
    store.set('lyle:tools:42:project-a', JSON.stringify({ mcpToolIds: [-1, '7', 2, 3], workspaceId: -3, localCli: true, token: 'forged' }))
    const tools = scope.run(() => useToolSelection(ref('project-a')))!
    expect(tools.selection.value).toEqual({ mcpToolIds: [2, 3], workspaceId: null })
    expect(tools.localWorkspace.value).toBeNull()
  })
})
