import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { authState } from '@/auth'
import type { NativeWorkspace, ToolSelection } from '@/api/integrations'

export function useToolSelection(scope: Ref<string>) {
  const selection = ref<ToolSelection>({ mcpToolIds: [] })
  const localWorkspace = ref<NativeWorkspace | null>(null)
  onScopeDispose(() => { if (localWorkspace.value) void window.lyleTools?.disconnect(localWorkspace.value.token).catch(() => undefined) })
  watch(() => `${authState.user?.id ?? 'anonymous'}:${scope.value}`, key => {
    if (localWorkspace.value) void window.lyleTools?.disconnect(localWorkspace.value.token).catch(() => undefined)
    selection.value = { mcpToolIds: [] }; localWorkspace.value = null
    try {
      const stored = JSON.parse(sessionStorage.getItem(`lyle:tools:${key}`) || 'null')
      if (stored && Array.isArray(stored.mcpToolIds)) selection.value = {
        mcpToolIds: stored.mcpToolIds.filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0).slice(0, 20),
        workspaceId: Number.isSafeInteger(stored.workspaceId) && stored.workspaceId > 0 ? stored.workspaceId : null,
      }
    } catch { /* A bad saved preference never grants tools. */ }
  }, { immediate: true })
  watch(localWorkspace, (value, old) => {
    if (old && old.token !== value?.token) void window.lyleTools?.disconnect(old.token).catch(() => undefined)
  })
  watch(selection, value => {
    try { sessionStorage.setItem(`lyle:tools:${authState.user?.id ?? 'anonymous'}:${scope.value}`, JSON.stringify({ ...value, localCli: false })) } catch { /* Selection still works for this view. */ }
  }, { deep: true })
  return { selection, localWorkspace }
}
