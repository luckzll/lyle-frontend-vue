import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import LocalWorkspaceAttachments from '@/components/chat/LocalWorkspaceAttachments.vue'
import { LocalWorkspace, type LocalDirectoryHandle } from '@/domain/local-workspace'

function previewWorkspace() {
  const root: LocalDirectoryHandle = { kind: 'directory', name: 'folder', async *entries() {},
    async getDirectoryHandle() { throw new Error('not used') }, async getFileHandle() { throw new Error('not used') },
    async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' } }
  return new LocalWorkspace(root)
}

describe('local attachment controls', () => {
  it('labels folder attachments as conversation inputs with their own write selector and plain files as read-only', async () => {
    const html = await renderToString(createSSRApp(LocalWorkspaceAttachments, { items: [
      { id: 'plain', name: 'README.md', kind: 'file', path: '@attachments/plain', writable: false },
      { id: 'folder', name: 'shared-code', kind: 'folder', path: '@attachments/folder', workspace: previewWorkspace(), writable: true }
    ] }))
    expect(html).toContain('附件仅用于当前对话')
    expect(html).toContain('只读附件')
    expect(html).toContain('shared-code的写入权限')
    expect(html).toContain('每个附件单独授权写入')
    expect(html).toContain('移除附件README.md')
    expect(html).toContain('移除附件shared-code')
    expect(html).not.toContain('README.md的写入权限')
    expect(html).not.toContain('新建项目')
  })

  it('escapes untrusted file labels and exposes image alt text without rendering their names as markup', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgo='
    const html = await renderToString(createSSRApp(LocalWorkspaceAttachments, { items: [
      { id: 'image', name: '<script>alert(1)</script>.png', kind: 'image', image, writable: false },
      { id: 'file', name: '<img onerror=alert(1)>.ts', kind: 'file', path: '@attachments/file', writable: false }
    ] }))
    expect(html).toContain('alt="&lt;script&gt;alert(1)&lt;/script&gt;.png"')
    expect(html).toContain('data-attachment-kind="image"')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img onerror=')
    expect(html).toContain('图片将在下一次发送时提供给模型')
    expect(html).toContain('下次发送时分析')
  })

  it('disables remove and write-policy controls while a task owns the attachment handles', async () => {
    const html = await renderToString(createSSRApp(LocalWorkspaceAttachments, { disabled: true, items: [
      { id: 'folder', name: 'shared-code', kind: 'folder', path: '@attachments/folder', workspace: previewWorkspace(), writable: true }
    ] }))
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(1)
    expect(html).toMatch(/<select[^>]*disabled/)
  })

  it('adds no tray height or duplicate attachment actions when nothing is selected', async () => {
    const html = await renderToString(createSSRApp(LocalWorkspaceAttachments, { items: [] }))
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<ul')
    expect(html).not.toContain('local-attachments')
  })
})
