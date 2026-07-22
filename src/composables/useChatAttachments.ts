import { computed, onBeforeUnmount, ref } from 'vue'
import type { ChatAttachment, ChatAttachmentDraft, ChatAttachmentKind } from '@/domain/chat-attachment'
import { CHAT_ATTACHMENT_LIMITS } from '@/domain/chat-attachment'

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const FILE_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'log', 'xlsx'])

export function useChatAttachments(options: {
  upload: (file: File, kind: ChatAttachmentKind) => Promise<ChatAttachment>
  remove?: (attachmentId: string) => Promise<unknown>
}) {
  const attachments = ref<ChatAttachmentDraft[]>([])
  const announcement = ref('')

  const isUploading = computed(() => attachments.value.some((item) => ['local', 'uploading'].includes(item.status)))
  const hasFailed = computed(() => attachments.value.some((item) => item.status === 'failed'))
  const allReady = computed(() => attachments.value.length > 0 && attachments.value.every((item) => item.status === 'ready'))
  const totalBytes = computed(() => attachments.value.reduce((sum, item) => sum + item.size, 0))

  async function addFiles(files: File[], source: 'picker' | 'drop' | 'paste' = 'picker') {
    if (!files.length) return
    const slots = Math.max(0, CHAT_ATTACHMENT_LIMITS.maxCount - attachments.value.length)
    const acceptedFiles = files.slice(0, slots)
    const drafts = acceptedFiles.map(createDraft)
    const startIndex = attachments.value.length
    attachments.value.push(...drafts)
    const reactiveDrafts = attachments.value.slice(startIndex)
    if (files.length > slots) {
      announcement.value = `单轮最多添加 ${CHAT_ATTACHMENT_LIMITS.maxCount} 个附件，超出的文件未加入。`
    } else {
      announcement.value = `已从${sourceLabel(source)}添加 ${drafts.length} 个附件。`
    }
    validateTotals()
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
    revokePreview(draft)
    if (draft.attachmentId && options.remove) {
      await options.remove(draft.attachmentId).catch(() => undefined)
    }
    announcement.value = `已移除 ${draft.name}。`
  }

  function commitReady(): ChatAttachment[] {
    const committed = attachments.value.flatMap((draft) => draft.attachment ? [draft.attachment] : [])
    attachments.value.forEach(revokePreview)
    attachments.value = []
    announcement.value = committed.length ? `${committed.length} 个附件已随消息发送。` : ''
    return committed
  }

  function reset() {
    attachments.value.forEach(revokePreview)
    attachments.value = []
    announcement.value = ''
  }

  function createDraft(file: File): ChatAttachmentDraft {
    const kind: ChatAttachmentKind = IMAGE_TYPES.has(file.type.toLowerCase()) ? 'image' : 'file'
    const error = validateFile(file)
    return {
      localId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      kind,
      file,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      previewUrl: kind === 'image' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
      status: error ? 'failed' : 'local',
      error
    }
  }

  function validateTotals() {
    if (totalBytes.value <= CHAT_ATTACHMENT_LIMITS.maxTotalBytes) return
    let running = 0
    for (const draft of attachments.value) {
      running += draft.size
      if (running > CHAT_ATTACHMENT_LIMITS.maxTotalBytes && draft.status !== 'failed') {
        draft.status = 'failed'
        draft.error = '单轮附件总量不能超过 20MB。'
      }
    }
    announcement.value = '部分附件超过单轮 20MB 总量限制，请移除后重试。'
  }

  async function uploadQueue(drafts: ChatAttachmentDraft[]) {
    let cursor = 0
    const workers = Array.from({ length: Math.min(CHAT_ATTACHMENT_LIMITS.uploadConcurrency, drafts.length) }, async () => {
      while (cursor < drafts.length) {
        const draft = drafts[cursor++]
        if (!draft || draft.status !== 'local') continue
        draft.status = 'uploading'
        try {
          const attachment = await options.upload(draft.file, draft.kind)
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
    announcement.value = `${readyCount} 个附件已就绪。`
  }

  onBeforeUnmount(reset)

  return { attachments, announcement, isUploading, hasFailed, allReady, totalBytes, addFiles, retry, remove, commitReady, reset }
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

function sourceLabel(source: 'picker' | 'drop' | 'paste') {
  if (source === 'drop') return '拖拽'
  if (source === 'paste') return '剪贴板'
  return '文件选择器'
}
