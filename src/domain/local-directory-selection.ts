import type { LocalDirectoryHandle } from './local-workspace'

// Transfer a user-picked handle across navigation without losing user activation.
const selections = new Map<string, { owner: string; handle: LocalDirectoryHandle }>()
export function stageDirectorySelection(request: string, owner: string, handle: LocalDirectoryHandle) {
  selections.clear()
  selections.set(request, { owner, handle })
}
export function takeDirectorySelection(request: string, owner: string) {
  const selection = selections.get(request)
  selections.delete(request)
  return selection?.owner === owner ? selection.handle : undefined
}
export function discardDirectorySelection(request: string) { selections.delete(request) }
