import { onScopeDispose, readonly, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { isLocalHistoryStorageKey, LOCAL_HISTORY_CHANGED_EVENT, readLocalHistoryMetadata, type LocalProject, type LocalSessionMetadata } from '@/domain/local-workspace-history'

/** Read-only navigation metadata, independent of an open workspace's save baseline. */
export function useLocalProjectNavigation(owner: MaybeRefOrGetter<string | number | null | undefined>) {
  const projects = ref<LocalProject[]>([])
  const sessions = ref<LocalSessionMetadata[]>([])
  const activeId = ref<string | null>(null)
  const activeProjectId = ref<string | null>(null)
  const error = ref<string | null>(null)

  function refresh() {
    const id = toValue(owner)
    if (id == null) {
      projects.value = []; sessions.value = []; activeId.value = null; activeProjectId.value = null; error.value = null
      return
    }
    const metadata = readLocalHistoryMetadata(id)
    projects.value = metadata.projects; sessions.value = metadata.sessions
    activeId.value = metadata.activeId; activeProjectId.value = metadata.activeProjectId; error.value = metadata.error
  }
  function onSaved(event: Event) {
    const id = toValue(owner)
    if (id != null && (event as CustomEvent<{ owner?: string }>).detail?.owner === String(id).trim()) refresh()
  }
  function onStorage(event: StorageEvent) {
    const id = toValue(owner)
    if (id != null && isLocalHistoryStorageKey(event.key, id)) refresh()
  }

  const stop = watch(() => toValue(owner), refresh, { immediate: true, flush: 'sync' })
  if (typeof window !== 'undefined') {
    window.addEventListener(LOCAL_HISTORY_CHANGED_EVENT, onSaved)
    window.addEventListener('storage', onStorage)
  }
  onScopeDispose(() => {
    stop()
    if (typeof window !== 'undefined') {
      window.removeEventListener(LOCAL_HISTORY_CHANGED_EVENT, onSaved)
      window.removeEventListener('storage', onStorage)
    }
  })

  return { projects: readonly(projects), sessions: readonly(sessions), activeId: readonly(activeId), activeProjectId: readonly(activeProjectId), error: readonly(error), refresh }
}
