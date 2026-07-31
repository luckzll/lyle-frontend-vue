import { computed, onBeforeUnmount, ref } from 'vue'
import type { AttachmentFolderMetadata, ChatAttachment, ChatAttachmentDraft, ChatAttachmentKind, IncomingAttachmentFile } from '@/domain/chat-attachment'
import { CHAT_ATTACHMENT_LIMITS } from '@/domain/chat-attachment'
import type { DirectorySkip } from '@/domain/directory-entry'
import { directorySkippedCount } from '@/domain/directory-entry'

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const FILE_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'log', 'xlsx'])

export function useChatAttachments(options: {
  upload: (file: File, kind: ChatAttachmentKind, metadata: AttachmentFolderMetadata) => Promise<ChatAttachment>
  remove?: (attachmentId: string) => Promise<unknown>
}) {
  const attachments = ref<ChatAttachmentDraft[]>([])
  const skipped = ref<DirectorySkip[]>([])
  const announcement = ref('')

  const isUploading = computed(() => attachments.value.some((item) => ['local', 'uploading'].includes(item.status)))
  const hasFailed = computed(() => attachments.value.some((item) => item.status === 'failed'))
  const allReady = computed(() => attachments.value.length > 0 && attachments.value.every((item) => item.status === 'ready'))
  const totalBytes = computed(() => attachments.value.reduce((sum, item) => sum + item.size, 0))

  async function addFiles(files: IncomingAttachmentFile[], scanSkipped: DirectorySkip[] = []) {
    if (!files.length && !scanSkipped.length) return
    skipped.value = [...scanSkipped]
    const slots = Math.max(0, CHAT_ATTACHMENT_LIMITS.maxCount - attachments.value.length)
    const acceptedFiles: IncomingAttachmentFile[] = []
    let acceptedBytes = attachments.value.reduce((sum, item) => sum + item.size, 0)
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
      if (acceptedFiles.length >= slots) {
        skipped.value.push({ name: item.file.name, relativePath: item.relativePath, reason: 'count' })
        continue
      }
      if (acceptedBytes + item.file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
        skipped.value.push({ name: item.file.name, relativePath: item.relativePath, reason: 'total_size' })
        continue
      }
      acceptedFiles.push(item)
      acceptedBytes += item.file.size
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
    const kind: ChatAttachmentKind = IMAGE_TYPES.has(file.type.toLowerCase()) ? 'image' : 'file'
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
    let cursor = 0
    const workers = Array.from({ length: Math.min(CHAT_ATTACHMENT_LIMITS.uploadConcurrency, drafts.length) }, async () => {
      while (cursor < drafts.length) {
        const draft = drafts[cursor++]
        if (!draft || draft.status !== 'local') continue
        draft.status = 'uploading'
        try {
          const metadata: AttachmentFolderMetadata = {
            sourceType: draft.sourceType,
            folderGroupId: draft.folderGroupId,
            folderRoot: draft.folderRoot,
            relativePath: draft.relativePath,
            sourceOrder: draft.sourceOrder
          }
          const response = await options.upload(draft.file, draft.kind, metadata)
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
        }
      }
    })
    await Promise.all(workers)
    const readyCount = attachments.value.filter((item) => item.status === 'ready').length
    const failedCount = attachments.value.filter((item) => item.status === 'failed').length
    announcement.value = `${readyCount} 个附件已就绪${failedCount ? `，${failedCount} 个需要处理` : ''}${skipped.value.length ? `，跳过 ${directorySkippedCount(skipped.value)} 个` : ''}。`
  }

  function updateAnnouncement(added: number) {
    announcement.value = `已加入 ${added} 个文件${skipped.value.length ? `，跳过 ${directorySkippedCount(skipped.value)} 个` : ''}。`
  }

  onBeforeUnmount(reset)

  return { attachments, skipped, announcement, isUploading, hasFailed, allReady, totalBytes, addFiles, retry, remove, commitReady, reset }
}

function validateFile(file: File) {
  if (file.size > CHAT_ATTACHMENT_LIMITS.maxFileBytes) return '单个附件不能超过 5MB。'
  const type = file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_TYPES.has(type)) return ''
  if (FILE_EXTENSIONS.has(extension)) return ''
  return '仅支持 JPG、PNG、WEBP、GIF、PDF、DOCX、TXT、MD、CSV、JSON、LOG、XLSX。'
}

function requestError(exception: unknown) {
  const data = (exception as { response?: { data?: unknown } })?.response?.data
  if (typeof data === 'string' && data.trim()) return data
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const message = record.detail || record.message || record.error
    if (typeof message === 'string' && message.trim()) return message
  }
  return exception instanceof Error ? exception.message : '附件上传失败，请重试。'
}

function revokePreview(draft: ChatAttachmentDraft) {
  if (draft.previewUrl?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(draft.previewUrl)
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}
