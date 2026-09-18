import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatAttachments } from '@/composables/useChatAttachments'
import { CHAT_FILE_EXTENSIONS, CHAT_EXACT_FILENAMES, isSupportedChatFile, type ChatAttachment, type IncomingAttachmentFile } from '@/domain/chat-attachment'

const incoming = (name: string, group = 'project', type = ''): IncomingAttachmentFile => ({
  file: new File(['export const 中文 = 1'], name, { type }), sourceType: group ? 'folder_picker' : 'picker',
  folderGroupId: group || undefined, folderRoot: group || undefined, relativePath: group ? `${group}/src/${name}` : undefined, sourceOrder: 0
})
const uploaded = async (file: File): Promise<ChatAttachment> => ({ id: file.name, kind: 'file', name: file.name, mimeType: 'text/plain', size: file.size })

describe('chat attachment queue', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('announces an empty folder and keeps a visible skip reason', async () => {
    const upload = vi.fn()
    const queue = useChatAttachments({ upload })

    await queue.addFiles([], [{
      name: '空资料',
      relativePath: '空资料',
      reason: 'empty_directory'
    }])

    expect(upload).not.toHaveBeenCalled()
    expect(queue.skipped.value).toEqual([
      expect.objectContaining({ name: '空资料', reason: 'empty_directory' })
    ])
    expect(queue.announcement.value).toBe('未添加附件，已跳过 1 个文件或条目。')
  })

  it('uploads supported source/config contents and preserves every relative path', async () => {
    const upload = vi.fn(uploaded)
    const queue = useChatAttachments({ upload })
    const files = [...CHAT_FILE_EXTENSIONS.map(extension => incoming(`source.${extension}`)), ...CHAT_EXACT_FILENAMES.map(name => incoming(name))]
    await queue.addFiles(files)
    expect(queue.attachments.value).toHaveLength(files.length)
    expect(queue.skipped.value).toEqual([])
    expect(await upload.mock.calls[0][0].text()).toBe('export const 中文 = 1')
    expect(queue.attachments.value.every(item => item.attachment?.relativePath === `project/src/${item.name}`)).toBe(true)
    for (const name of ['.env', '.secret.ts', 'app.exe', 'archive.zip', 'dockerfile']) expect(isSupportedChatFile({ name, type: 'text/plain' })).toBe(false)
  })

  it('keeps loose attachments at eight while allowing up to 200 total project files', async () => {
    const queue = useChatAttachments({ upload: uploaded })
    await queue.addFiles(Array.from({ length: 10 }, (_, index) => incoming(`loose-${index}.ts`, '')))
    expect(queue.attachments.value).toHaveLength(8)
    expect(queue.skipped.value.filter(item => item.reason === 'count')).toHaveLength(2)
    await queue.addFiles(Array.from({ length: 195 }, (_, index) => incoming(`project-${index}.ts`)))
    expect(queue.attachments.value).toHaveLength(200)
    expect(queue.skipped.value.filter(item => item.reason === 'count')).toHaveLength(5)
  })

  it('uses image extensions consistently across blank or misleading browser MIME and caps all images at eight', async () => {
    const upload = vi.fn(uploaded)
    const queue = useChatAttachments({ upload })
    await queue.addFiles([incoming('App.ts', 'project', 'image/png'), ...Array.from({ length: 9 }, (_, index) => incoming(`image-${index}.png`))])
    expect(queue.attachments.value.find(item => item.name === 'App.ts')?.kind).toBe('file')
    expect(queue.attachments.value.filter(item => item.kind === 'image')).toHaveLength(8)
    expect(queue.skipped.value).toEqual([expect.objectContaining({ name: 'image-8.png', reason: 'image_count' })])
  })

  it('preserves the per-file and per-turn byte limits', async () => {
    const files = Array.from({ length: 5 }, (_, index) => incoming(`large-${index}.ts`))
    for (const item of files) Object.defineProperty(item.file, 'size', { value: 5 * 1024 * 1024 })
    const oversized = incoming('oversized.ts')
    Object.defineProperty(oversized.file, 'size', { value: 5 * 1024 * 1024 + 1 })
    const queue = useChatAttachments({ upload: uploaded })
    await queue.addFiles([...files, oversized])
    expect(queue.attachments.value).toHaveLength(4)
    expect(queue.skipped.value.map(item => item.reason)).toEqual(['total_size', 'size'])
  })

  it('limits simultaneous uploads across multiple drops and removes a group while uploads are in flight', async () => {
    const releases: Array<() => void> = []
    let active = 0
    let peak = 0
    const upload = vi.fn((file: File) => new Promise<ChatAttachment>(resolve => {
      active += 1; peak = Math.max(peak, active)
      releases.push(() => { active -= 1; void uploaded(file).then(resolve) })
    }))
    const remove = vi.fn(async () => undefined)
    const queue = useChatAttachments({ upload, remove })
    const first = queue.addFiles(Array.from({ length: 5 }, (_, index) => incoming(`first-${index}.ts`, 'one')))
    const second = queue.addFiles(Array.from({ length: 5 }, (_, index) => incoming(`second-${index}.ts`, 'two')))
    expect(upload).toHaveBeenCalledTimes(3)
    await queue.removeGroup('one')
    while (queue.isUploading.value || active) {
      releases.splice(0).forEach(release => release())
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    await Promise.all([first, second])
    expect(peak).toBe(3)
    expect(queue.attachments.value.map(item => item.folderGroupId)).toEqual(Array(5).fill('two'))
    expect(remove).toHaveBeenCalledTimes(3)
    expect(upload.mock.calls.some(([file]) => file.name === 'first-4.ts')).toBe(false)
  })

  it('keeps a failed source file retryable without discarding its folder', async () => {
    const upload = vi.fn(uploaded).mockRejectedValueOnce(new Error('网络中断'))
    const queue = useChatAttachments({ upload })
    await queue.addFiles([incoming('App.vue')])
    const draft = queue.attachments.value[0]
    expect(draft.status).toBe('failed')
    await queue.retry(draft.localId)
    expect(draft.status).toBe('ready')
    expect(draft.attachment?.relativePath).toBe('project/src/App.vue')
  })
})
