import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatAttachments } from '@/composables/useChatAttachments'

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
})
