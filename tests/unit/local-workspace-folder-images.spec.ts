import { describe, expect, it, vi } from 'vitest'
import { LocalWorkspace, imageName, type LocalDirectoryHandle, type LocalFileHandle } from '@/domain/local-workspace'
import { compressWorkspaceImage } from '@/domain/local-workspace-images'

vi.mock('@/domain/local-workspace-images', () => ({ compressWorkspaceImage: vi.fn(async () => 'data:image/jpeg;base64,/9j/2Q==') }))

function fixture() {
  const picture = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'diagram.PNG')
  let reads = 0; let writes = 0
  const handle: LocalFileHandle = { kind: 'file', name: picture.name,
    async getFile() { reads++; return picture },
    async createWritable() { writes++; throw new Error('must not write images') } }
  const folder: LocalDirectoryHandle = { kind: 'directory', name: 'screenshots',
    async *entries() { yield [handle.name, handle] },
    async getDirectoryHandle() { throw new Error('missing') },
    async getFileHandle(name) { if (name !== picture.name) throw new Error('missing'); return handle },
    async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' } }
  const root: LocalDirectoryHandle = { ...folder, name: 'project',
    async *entries() { yield ['screenshots', folder] },
    async getDirectoryHandle(name) { if (name !== folder.name) throw new Error('missing'); return folder },
    async getFileHandle() { throw new Error('missing') } }
  return { workspace: new LocalWorkspace(root), counts: () => ({ reads, writes }) }
}

describe('authorized folder image reads', () => {
  it('lists nested pictures without silently hiding or loading them', async () => {
    const f = fixture()
    expect((await f.workspace.list('screenshots')).entries).toEqual([
      { name: 'diagram.PNG', kind: 'file', path: 'screenshots/diagram.PNG', contentType: 'image' },
    ])
    expect(f.counts()).toEqual({ reads: 0, writes: 0 })
  })
  it('loads real file bytes for the bounded image encoder only when the tool reads a picture', async () => {
    const f = fixture()
    const result = await f.workspace.executeRead({ id: 'read-image', name: 'workspace_read', args: { path: 'screenshots/diagram.PNG' } }, new AbortController().signal)
    expect(result).toMatchObject({ kind: 'image', path: 'screenshots/diagram.PNG', image: 'data:image/jpeg;base64,/9j/2Q==', nextOffset: null })
    const passed = vi.mocked(compressWorkspaceImage).mock.calls.at(-1)![0]
    expect(passed.name).toBe('diagram.PNG')
    expect(passed.type).toBe('image/png')
    expect(new Uint8Array(await passed.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(f.counts()).toEqual({ reads: 1, writes: 0 })
  })
  it('rejects traversals, text pagination and text writes to images', async () => {
    const f = fixture()
    await expect(f.workspace.readImage('../diagram.PNG')).rejects.toThrow()
    await expect(f.workspace.readImage('screenshots/diagram.PNG', 1)).rejects.toThrow('分页')
    await expect(f.workspace.preview({ id: 'bad-edit', name: 'workspace_edit', args: { path: 'screenshots/diagram.PNG', expectedHash: 'fake', oldText: 'x', newText: 'y' } })).rejects.toThrow('图片')
    await expect(f.workspace.preview({ id: 'bad-create', name: 'workspace_create', args: { path: 'screenshots/new.jpg', content: 'fake bytes' } })).rejects.toThrow('图片')
    expect(f.counts()).toEqual({ reads: 0, writes: 0 })
  })
  it('searches text without decoding or claiming matches inside unread pictures', async () => {
    const f = fixture()
    expect((await f.workspace.search('', 'diagram', new AbortController().signal)).matches).toEqual([])
    expect(f.counts()).toEqual({ reads: 0, writes: 0 })
  })
  it('limits extensions and keeps hidden or unsafe file names outside the picture boundary', () => {
    for (const name of ['x.png', 'x.JPG', 'x.jpeg', 'x.webp']) expect(imageName(name)).toBe(true)
    for (const name of ['.secret.png', 'x.svg', 'x.exe', '../x.png', 'x.png:secret', 'NUL.png']) expect(imageName(name)).toBe(false)
  })
  it('does not read picture bytes after cancellation', async () => {
    const f = fixture(); const control = new AbortController(); control.abort()
    await expect(f.workspace.executeRead({ id: 'read-image', name: 'workspace_read', args: { path: 'screenshots/diagram.PNG' } }, control.signal)).rejects.toThrow()
    expect(f.counts()).toEqual({ reads: 0, writes: 0 })
  })
})
