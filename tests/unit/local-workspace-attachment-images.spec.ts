import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addLocalAttachment, attachmentManifest, clearLocalAttachments, fileAttachmentWorkspace, folderFilesWorkspace,
  LocalConversationWorkspace, localAttachments, type AttachmentScope } from '@/domain/local-workspace-attachments'
import { compressWorkspaceImage, workspaceImageToolResult, workspaceReadImageMessage } from '@/domain/local-workspace-images'

const pixels = 'data:image/jpeg;base64,/9j/AAH/2Q=='
vi.mock('@/domain/local-workspace-images', async importOriginal => ({
  ...await importOriginal<typeof import('@/domain/local-workspace-images')>(),
  compressWorkspaceImage: vi.fn(async () => pixels)
}))
const scope: AttachmentScope = { owner: 'attachment-image-owner', projectId: 'project', sessionId: 'session' }
const signal = () => new AbortController().signal
function picture(name: string, path: string, bytes: number[], mime = '') {
  return Object.defineProperty(new File([new Uint8Array(bytes)], name, { type: mime }), 'webkitRelativePath', { value: path }) as File
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.mocked(compressWorkspaceImage).mockClear() })
afterEach(() => { clearLocalAttachments(scope.owner); vi.unstubAllGlobals() })

describe('pictures inside conversation folder attachments', () => {
  it('retains PNG, JPEG and WebP in a fallback folder while excluding credentials and unsupported binary types', async () => {
    const files = [picture('board.png', 'assets/screens/board.png', [0x89, 0x50]),
      picture('photo.jpeg', 'assets/screens/photo.jpeg', [0xff, 0xd8]),
      picture('prototype.webp', 'assets/screens/prototype.webp', [82, 73]),
      picture('.private.png', 'assets/screens/.private.png', [0x89, 0x50]),
      picture('graphic.svg', 'assets/screens/graphic.svg', [60, 115])]
    const entry = addLocalAttachment(scope, { name: 'assets', kind: 'folder', workspace: folderFilesWorkspace(files), writable: false })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    const listing = await router.executeRead({ id: 'list', name: 'workspace_list', args: { path: `${entry.path}/screens` } }, signal())
    expect(listing).toMatchObject({ entries: [
      { name: 'board.png', path: `${entry.path}/screens/board.png`, contentType: 'image' },
      { name: 'photo.jpeg', path: `${entry.path}/screens/photo.jpeg`, contentType: 'image' },
      { name: 'prototype.webp', path: `${entry.path}/screens/prototype.webp`, contentType: 'image' }
    ] })
    expect(compressWorkspaceImage).not.toHaveBeenCalled()
  })

  it('forwards the actual selected picture bytes to the compressor and keeps the namespace for the model image input', async () => {
    const original = picture('board.png', 'assets/screens/board.png', [0x89, 0x50, 0x4e, 0x47, 0, 9])
    const entry = addLocalAttachment(scope, { name: 'assets', kind: 'folder', workspace: folderFilesWorkspace([original]), writable: false })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    const path = `${entry.path}/screens/board.png`
    const result = await router.executeRead({ id: 'read', name: 'workspace_read', args: { path } }, signal())
    expect(result).toMatchObject({ kind: 'image', path, image: pixels })
    const encodedFile = vi.mocked(compressWorkspaceImage).mock.calls[0]![0]
    expect(encodedFile.type).toBe('image/png')
    expect(new Uint8Array(await encodedFile.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()))
    const packed = workspaceImageToolResult(result)
    expect(JSON.stringify(packed.result)).not.toContain('data:image')
    expect(packed.image?.path).toBe(path)
    const imageInput = workspaceReadImageMessage([packed.image!])!
    expect(imageInput.images).toEqual([pixels])
    expect(imageInput.content).toContain(path)
  })

  it('keeps the same filename in two attached folders separate through image read and input construction', async () => {
    const one = addLocalAttachment(scope, { name: 'one', kind: 'folder',
      workspace: folderFilesWorkspace([picture('screen.png', 'one/screen.png', [1, 2, 3])]), writable: false })
    const two = addLocalAttachment(scope, { name: 'two', kind: 'folder',
      workspace: folderFilesWorkspace([picture('screen.png', 'two/screen.png', [4, 5, 6])]), writable: false })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    const results = await Promise.all([one, two].map(item => router.executeRead({ id: item.id, name: 'workspace_read', args: { path: `${item.path}/screen.png` } }, signal())))
    const images = results.map(result => workspaceImageToolResult(result).image!)
    expect(new Set(images.map(image => image.path)).size).toBe(2)
    const message = workspaceReadImageMessage(images)!
    expect(message.content).toContain(`${one.path}/screen.png`)
    expect(message.content).toContain(`${two.path}/screen.png`)
    expect(message.images).toHaveLength(2)
  })

  it('keeps an uploaded picture outside tool routing even when a caller supplies a workspace handle', async () => {
    const file = picture('screen.webp', '', [82, 73, 70, 70], 'image/webp')
    const resource = addLocalAttachment(scope, { name: file.name, kind: 'image',
      workspace: fileAttachmentWorkspace(file), writable: false })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    expect(resource.path).toBeUndefined()
    expect(router.connected).toBe(false)
    expect(await router.executeRead({ id: 'list', name: 'workspace_list', args: { path: '@attachments' } }, signal())).toMatchObject({ entries: [] })
    expect(attachmentManifest(localAttachments(scope), false)).not.toContain(file.name)
    const path = `@attachments/${resource.id}/screen.webp`
    await expect(router.executeRead({ id: 'read', name: 'workspace_read', args: { path } }, signal())).rejects.toThrow('不可用')
    await expect(router.preview({ id: 'edit', name: 'workspace_edit', args: { path, expectedHash: 'fake', oldText: 'a', newText: 'b' } })).rejects.toThrow('不可用')
    expect(compressWorkspaceImage).not.toHaveBeenCalled()
  })

  it('rejects unsupported or oversized folder pictures without treating them as text attachments', () => {
    expect(() => folderFilesWorkspace([picture('icon.svg', 'assets/icon.svg', [60, 115])])).toThrow('没有允许读取')
    const huge = Object.defineProperty(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png'), 'webkitRelativePath', { value: 'assets/huge.png' }) as File
    expect(() => folderFilesWorkspace([huge])).toThrow('没有允许读取')
    expect(() => fileAttachmentWorkspace(huge)).toThrow('10 MB')
  })
})
