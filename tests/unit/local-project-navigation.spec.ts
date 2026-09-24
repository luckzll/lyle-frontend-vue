import { effectScope, isReadonly, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalProjectNavigation } from '@/composables/useLocalProjectNavigation'
import { createLocalProject, createLocalSessionForProject, loadLocalHistory, saveLocalHistory, LOCAL_HISTORY_CHANGED_EVENT, type LocalHistory } from '@/domain/local-workspace-history'

let disk: Map<string, string>; let target: EventTarget; let scope: EffectScope
const key = (owner: string) => `lyle:local-workspace-history:v1:${owner}`
function fixture(): LocalHistory {
  const project = createLocalProject('app'); const session = createLocalSessionForProject(project)
  return { projects: [project], sessions: [session], activeId: session.id, activeProjectId: project.id }
}
function changed(key: string | null) { target.dispatchEvent(Object.assign(new Event('storage'), { key })) }
beforeEach(() => {
  disk = new Map(); target = new EventTarget(); scope = effectScope()
  vi.stubGlobal('window', target)
  vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) })
})
afterEach(() => { scope.stop(); vi.unstubAllGlobals() })

describe('local project navigation metadata subscription', () => {
  it('updates same-tab saves and clears immediately on owner changes without exposing bodies', () => {
    const owner = ref<string | null>('first')
    const nav = scope.run(() => useLocalProjectNavigation(owner))!
    const data = fixture(); expect(nav.projects.value).toEqual([])
    saveLocalHistory('first', data)
    expect(nav.projects.value[0]!.id).toBe(data.projects[0]!.id)
    expect(nav.activeId.value).toBe(data.activeId)
    expect(isReadonly(nav.sessions)).toBe(true)
    expect(nav.sessions.value[0]).not.toHaveProperty('transcript')
    owner.value = 'other'
    expect(nav.projects.value).toEqual([])
    target.dispatchEvent(new CustomEvent(LOCAL_HISTORY_CHANGED_EVENT, { detail: { owner: 'first' } }))
    expect(nav.projects.value).toEqual([])
    saveLocalHistory('other', fixture())
    expect(nav.projects.value).toHaveLength(1)
    owner.value = null
    expect(nav.sessions.value).toEqual([])
    expect(nav.activeProjectId.value).toBeNull()
  })
  it('refreshes only matching cross-tab storage updates and keeps editor conflict detection intact', () => {
    const data = fixture(); saveLocalHistory('first', data); loadLocalHistory('first')
    const nav = scope.run(() => useLocalProjectNavigation(() => 'first'))!
    const external = JSON.parse(disk.get(key('first'))!); external.projects[0].name = 'external'
    disk.set(key('first'), JSON.stringify(external))
    changed(key('other')); expect(nav.projects.value[0]!.name).toBe('app')
    changed(key('first')); expect(nav.projects.value[0]!.name).toBe('external')
    expect(saveLocalHistory('first', data).ok).toBe(false)
    disk.clear(); changed(null)
    expect(nav.projects.value).toEqual([])
    expect(nav.activeId.value).toBeNull()
  })
  it('removes listeners when the owner scope is disposed', () => {
    const nav = scope.run(() => useLocalProjectNavigation('first'))!
    scope.stop()
    saveLocalHistory('first', fixture())
    changed(key('first'))
    expect(nav.projects.value).toEqual([])
  })
})
