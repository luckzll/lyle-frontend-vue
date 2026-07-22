export type ChatAttachmentKind = 'image' | 'file'
export type ChatAttachmentStatus = 'local' | 'uploading' | 'ready' | 'failed' | 'attached'

export interface ChatAttachment {
  id: string
  kind: ChatAttachmentKind
  name: string
  mimeType: string
  size: number
  status?: string
  previewUrl?: string
  downloadUrl?: string
  width?: number
  height?: number
}

export interface ChatAttachmentDraft {
  localId: string
  attachmentId?: string
  kind: ChatAttachmentKind
  file: File
  name: string
  mimeType: string
  size: number
  previewUrl?: string
  status: ChatAttachmentStatus
  error?: string
  attachment?: ChatAttachment
}

export const CHAT_ATTACHMENT_LIMITS = {
  maxCount: 8,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  uploadConcurrency: 3
} as const

export function attachmentContentUrl(value?: string) {
  if (!value) return ''
  return value.startsWith('/chat/') ? `/api${value}` : value
}
