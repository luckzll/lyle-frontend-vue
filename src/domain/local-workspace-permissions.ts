import type { LocalDirectoryHandle } from './local-workspace'

export type LocalPermissionMode = 'read-only' | 'confirm' | 'auto'

/** Application policy is scoped to one connected directory and is never persisted. */
export class LocalWorkspacePermissions {
  private selected: LocalPermissionMode = 'confirm'
  private selectionRevision = 0

  constructor(private readonly root: LocalDirectoryHandle) {}

  get mode(): LocalPermissionMode { return this.selected }

  /** Call directly from a user gesture: requesting browser permission must not be deferred. */
  async select(mode: LocalPermissionMode): Promise<LocalPermissionMode> {
    const revision = ++this.selectionRevision
    if (mode !== 'auto') {
      this.selected = mode
      return this.selected
    }
    const permission = await this.root.requestPermission({ mode: 'readwrite' })
    // A newer selection (particularly read-only) takes precedence over an old prompt.
    if (revision !== this.selectionRevision) return this.selected
    if (permission !== 'granted') throw new Error('未授予目录写入权限，已保留原权限设置')
    this.selected = 'auto'
    return this.selected
  }

  /** Call directly from the apply button, before resolving the pending change confirmation. */
  async authorizeConfirmedWrite(): Promise<void> {
    this.assertCanWrite(true)
    const permission = await this.root.requestPermission({ mode: 'readwrite' })
    this.assertCanWrite(true)
    if (permission !== 'granted') throw new Error('未授予写入权限，文件未修改')
  }

  assertCanWrite(confirmed = false): void {
    if (this.selected === 'read-only') throw new Error('当前为只读模式，文件未修改；请先调整项目权限')
    if (this.selected === 'confirm' && !confirmed) throw new Error('此修改需要逐项确认，文件未修改')
  }
}
