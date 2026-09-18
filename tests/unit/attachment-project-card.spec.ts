import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import FolderAttachmentGroup from '@/components/chat/FolderAttachmentGroup.vue'
import AttachmentTray from '@/components/chat/AttachmentTray.vue'
import { attachmentTreeFiles, buildAttachmentTree, type AttachmentTreeFile } from '@/domain/attachment-tree'
import { historyMessage, attachmentContextMetadata } from '@/domain/chat-history'
import type { ChatAttachment } from '@/domain/chat-attachment'

const files: AttachmentTreeFile[] = [
  { id: '1', name: 'App.vue', path: 'project/src/App.vue', size: 3000, status: 'ready' },
  { id: '2', name: 'main.ts', path: 'project/src/main.ts', size: 1200, status: 'failed', error: '网络中断' },
  { id: '3', name: 'package.json', path: 'project/package.json', size: 500, status: 'uploading' }
]

describe('compact project attachment cards', () => {
  it('constructs real nested folders without losing repeated basenames or natural file order', () => {
    const tree = buildAttachmentTree([...files, { ...files[0], id: 'other', path: 'project/tests/App.vue' }], 'project')
    expect(tree.map(node => node.type === 'folder' ? node.name : node.file.name)).toEqual(['src', 'tests', 'package.json'])
    expect(tree[0]).toMatchObject({ type: 'folder', children: [{ file: { path: 'project/src/App.vue' } }, { file: { path: 'project/src/main.ts' } }] })
    expect(tree[1]).toMatchObject({ type: 'folder', children: [{ file: { id: 'other', path: 'project/tests/App.vue' } }] })
  })

  it('defaults to one collapsed card with progress, failure, tree controls and nearby exclusions', async () => {
    const html = await renderToString(createSSRApp(FolderAttachmentGroup, { name: 'project', items: files,
      skipped: [{ name: 'node_modules', relativePath: 'project/node_modules', reason: 'ignored_directory' }] }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('上传副本')
    expect(html).toContain('正在上传 1/3')
    expect(html).toContain('1 个失败')
    expect(html).toContain('部分条目未导入')
    expect(html).toContain('上传进度 33%')
    expect(html).toContain('移除整个文件夹 project')
    expect(html).toContain('重新上传 project/src/main.ts')
    expect(html).toContain('移除 project/src/App.vue')
    expect(html).toContain('node_modules')
    expect(html).toContain('class="tree-folder"')
    expect(html).not.toContain('class="attachment-card"')
    expect(html).not.toContain('本地可修改')
  })

  it('reuses a read-only file tree for sent messages without upload or remove controls', async () => {
    const items = attachmentTreeFiles(files.map(file => ({ id: file.id, name: file.name, relativePath: file.path,
      size: file.size, kind: 'file' as const, mimeType: 'text/plain' })))
    const html = await renderToString(createSSRApp(FolderAttachmentGroup, { name: 'project', items, readonly: true }))
    expect(html).toContain('已附加 3/3')
    expect(html).toContain('下载 project/src/App.vue')
    expect(html).not.toContain('移除整个文件夹')
    expect(html).not.toContain('重新上传')
  })

  it('sums actual Jackson string-Long sizes numerically and never marks failed uploads all ready', async () => {
    const wire = [
      { id: '1', name: 'a.ts', size: '100', relativePath: 'project/a.ts', kind: 'file', mimeType: 'text/plain' },
      { id: '2', name: 'b.ts', size: '200', relativePath: 'project/b.ts', kind: 'file', mimeType: 'text/plain' }
    ]
    const items = attachmentTreeFiles(wire as unknown as ChatAttachment[])
    const html = await renderToString(createSSRApp(FolderAttachmentGroup, { name: 'project', items, readonly: true }))
    expect(items.map(item => item.size)).toEqual([100, 200])
    expect(html).toContain('300 B')
    expect(html).not.toContain('100200')
    const failedHtml = await renderToString(createSSRApp(FolderAttachmentGroup, { name: 'project', items: files.slice(0, 2) }))
    expect(failedHtml).toContain('需要处理 1/2')
    expect(failedHtml).not.toContain('已就绪')
  })

  it('preserves an exclusion-only result visibly even when no files can be attached', async () => {
    const html = await renderToString(createSSRApp(AttachmentTray, { attachments: [],
      skipped: [{ name: 'empty', reason: 'empty_directory' }] }))
    expect(html).toContain('跳过 1 个文件或条目')
    expect(html).toContain('空文件夹')
  })

  it('restores only explicit inherited-upload metadata without claiming a local folder connection', () => {
    const metadata = { attachmentContextInherited: true, attachmentContextSourceMessageId: 'user-message-1' }
    const restored = historyMessage({ id: 'a', role: 'assistant', conversationId: 'c', content: '分析', createdAt: '', metadata })
    expect(restored).toMatchObject(metadata)
    expect(attachmentContextMetadata({ attachmentContextInherited: 'true', attachmentContextSourceMessageId: 12 }))
      .toEqual({ attachmentContextInherited: undefined, attachmentContextSourceMessageId: undefined })
  })
})
