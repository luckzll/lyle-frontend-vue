import { computed, onBeforeUnmount, ref } from 'vue'
import type { AttachmentFolderMetadata, ChatAttachment, ChatAttachmentDraft, ChatAttachmentKind, IncomingAttachmentFile } from '@/domain/chat-attachment'
import { CHAT_ATTACHMENT_LIMITS, isChatImage, isSupportedChatFile } from '@/domain/chat-attachment'
import type { DirectorySkip } from '@/domain/directory-entry'
import { directorySkippedCount } from '@/domain/directory-entry'
import { attachmentRequestError } from '@/domain/attachment-error'

export function useChatAttachments(options: {
  upload: (file: File, kind: ChatAttachmentKind, metadata: AttachmentFolderMetadata) => Promise<ChatAttachment>
  remove?: (attachmentId: string) => Promise<unknown>
}) {
  const attachments = ref<ChatAttachmentDraft[]>([])
  const skipped = ref<DirectorySkip[]>([])
  const announcement = ref('')
  const uploadTasks: Array<{ draft: ChatAttachmentDraft; done: () => void }> = []
  let activeUploads = 0

  const isUploading = computed(() => attachments.value.some((item) => ['local', 'uploading'].includes(item.status)))
  const hasFailed = computed(() => attachments.value.some((item) => item.status === 'failed'))
  const allReady = computed(() => attachments.value.length > 0 && attachments.value.every((item) => item.status === 'ready'))
  const totalBytes = computed(() => attachments.value.reduce((sum, item) => sum + item.size, 0))

  async function addFiles(files: IncomingAttachmentFile[], scanSkipped: DirectorySkip[] = []) {
    if (!files.length && !scanSkipped.length) return
    skipped.value = [...skipped.value, ...scanSkipped]
    const acceptedFiles: IncomingAttachmentFile[] = []
    let acceptedBytes = attachments.value.reduce((sum, item) => sum + item.size, 0)
    let looseCount = attachments.value.filter(item => !item.folderGroupId).length
    let imageCount = attachments.value.filter(item => item.kind === 'image').length
    for (const item of files) {
      const validationError = validateFile(item.file)
      if (validationError) {
        skipped.value.push({
          name: item.file.name,
          relativePath: item.relativePath,
          reason: validationError.includes('5MB') ? 'size' : 'unsupported'
        })
        continue
      }
      if (acceptedFiles.length + attachments.value.length >= CHAT_ATTACHMENT_LIMITS.maxProjectCount
        || (!item.folderGroupId && looseCount >= CHAT_ATTACHMENT_LIMITS.maxCount)) {
        skipped.value.push({ name: item.file.name, relativePath: item.relativePath, reason: 'count' })
        continue
      }
      if (isChatImage(item.file) && imageCount >= CHAT_ATTACHMENT_LIMITS.maxImages) {
        skipped.value.push({ name: item.file.name, relativePath: item.relativePath, reason: 'image_count' })
        continue
      }
      if (acceptedBytes + item.file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
        skipped.value.push({ name: item.file.name, relativePath: item.relativePath, reason: 'total_size' })
        continue
      }
      acceptedFiles.push(item)
      acceptedBytes += item.file.size
      if (!item.folderGroupId) looseCount += 1
      if (isChatImage(item.file)) imageCount += 1
    }

    const drafts = acceptedFiles.map(createDraft)
    const startIndex = attachments.value.length
    attachments.value.push(...drafts)
    const reactiveDrafts = attachments.value.slice(startIndex)
    updateAnnouncement(drafts.length)
    await uploadQueue(reactiveDrafts.filter((item) => item.status === 'local'))
  }

  async function retry(localId: string) {
    const draft = attachments.value.find((item) => item.localId === localId)
    if (!draft) return
    const error = validateFile(draft.file)
    if (error) {
      draft.status = 'failed'
      draft.error = error
      return
    }
    draft.status = 'local'
    draft.error = undefined
    await uploadQueue([draft])
  }

  async function remove(localId: string) {
    const index = attachments.value.findIndex((item) => item.localId === localId)
    if (index < 0) return
    const [draft] = attachments.value.splice(index, 1)
    if (!draft) return
    revokePreview(draft)
    if (draft.attachmentId && options.remove) {
      await options.remove(draft.attachmentId).catch(() => undefined)
    }
    announcement.value = `已移除 ${draft.name}。`
  }

  async function removeGroup(folderGroupId: string) {
    const drafts = attachments.value.filter(item => item.folderGroupId === folderGroupId)
    const root = drafts[0]?.folderRoot
    await Promise.all(drafts.map(item => remove(item.localId)))
    if (root) skipped.value = skipped.value.filter(item => !item.relativePath?.startsWith(`${root}/`) && item.relativePath !== root)
    announcement.value = `已移除文件夹 ${root || ''}。`
  }

  function commitReady(): ChatAttachment[] {
    const committed = attachments.value.flatMap((draft, position) => draft.attachment ? [{ ...draft.attachment, position }] : [])
    attachments.value.forEach(revokePreview)
    attachments.value = []
    skipped.value = []
    announcement.value = committed.length ? `${committed.length} 个附件已随消息发送。` : ''
    return committed
  }

  function reset() {
    attachments.value.forEach(revokePreview)
    attachments.value = []
    skipped.value = []
    announcement.value = ''
  }

  function createDraft(incoming: IncomingAttachmentFile): ChatAttachmentDraft {
    const { file } = incoming
    const kind: ChatAttachmentKind = isChatImage(file) ? 'image' : 'file'
    return {
      localId: newId(),
      kind,
      file,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl: kind === 'image' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
      status: 'local',
      sourceType: incoming.sourceType,
      folderGroupId: incoming.folderGroupId,
      folderRoot: incoming.folderRoot,
      relativePath: incoming.relativePath,
      sourceOrder: incoming.sourceOrder
    }
  }

  async function uploadQueue(drafts: ChatAttachmentDraft[]) {
    if (!drafts.length) {
      const skippedCount = directorySkippedCount(skipped.value)
      announcement.value = skippedCount
        ? `未添加附件，已跳过 ${skippedCount} 个文件或条目。`
        : '未添加附件。'
      return
    }
    await Promise.all(drafts.map(draft => new Promise<void>(done => { uploadTasks.push({ draft, done }); pumpUploads() })))
    const readyCount = attachments.value.filter((item) => item.status === 'ready').length
    const failedCount = attachments.value.filter((item) => item.status === 'failed').length
    announcement.value = `${readyCount} 个附件已就绪${failedCount ? `，${failedCount} 个需要处理` : ''}${skipped.value.length ? `，跳过 ${directorySkippedCount(skipped.value)} 个` : ''}。`
  }

  function pumpUploads() {
    while (activeUploads < CHAT_ATTACHMENT_LIMITS.uploadConcurrency && uploadTasks.length) {
      const { draft, done } = uploadTasks.shift()!
      if (draft.status !== 'local' || !attachments.value.some(item => item.localId === draft.localId)) { done(); continue }
      activeUploads += 1
      draft.status = 'uploading'
      void (async () => {
        try {
          const metadata: AttachmentFolderMetadata = {
            sourceType: draft.sourceType,
            folderGroupId: draft.folderGroupId,
            folderRoot: draft.folderRoot,
            relativePath: draft.relativePath,
            sourceOrder: draft.sourceOrder
          }
          const response = await options.upload(draft.file, draft.kind, metadata)
          if (!attachments.value.some(item => item.localId === draft.localId)) {
            await options.remove?.(response.id).catch(() => undefined)
            return
          }
          const attachment = {
            ...response,
            sourceType: response.sourceType || draft.sourceType,
            folderGroupId: response.folderGroupId || draft.folderGroupId,
            folderRoot: response.folderRoot || draft.folderRoot,
            relativePath: response.relativePath || draft.relativePath
          }
          draft.attachment = attachment
          draft.attachmentId = attachment.id
          draft.status = 'ready'
          draft.error = undefined
        } catch (exception) {
          draft.status = 'failed'
          draft.error = requestError(exception)
        } finally {
          activeUploads -= 1
          done()
          pumpUploads()
        }
      })()
    }
  }

  function updateAnnouncement(added: number) {
    announcement.value = `已加入 ${added} 个文件${skipped.value.length ? `，跳过 ${directorySkippedCount(skipped.value)} 个` : ''}。`
  }

  onBeforeUnmount(reset)

  return { attachments, skipped, announcement, isUploading, hasFailed, allReady, totalBytes, addFiles, retry, remove, removeGroup, commitReady, reset }
}

function validateFile(file: File) {
  if (file.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) return '单个附件不能超过 5MB。'
  if (isSupportedChatFile(file)) return ''
  return '不支持此文件类型；可上传图片、文档、源代码或项目配置。'
}

function requestError(exception: unknown) {
  return attachmentRequestError(exception)
}

function revokePreview(draft: ChatAttachmentDraft) {
  if (draft.previewUrl?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(draft.previewUrl)
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}
