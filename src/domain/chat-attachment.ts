export type ChatAttachmentKind = 'image' | 'file'
export type ChatAttachmentStatus = 'local' | 'uploading' | 'ready' | 'failed' | 'attached'
export type AttachmentSource = 'picker' | 'drop' | 'paste' | 'folder_picker' | 'folder_drop'

export interface AttachmentFolderMetadata {
  sourceType: AttachmentSource
  folderGroupId?: string
  folderRoot?: string
  relativePath?: string
  sourceOrder: number
}

export interface IncomingAttachmentFile extends AttachmentFolderMetadata {
  file: File
}

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
  position?: number
  sourceType?: AttachmentSource
  folderGroupId?: string
  folderRoot?: string
  relativePath?: string
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
  sourceType: AttachmentSource
  folderGroupId?: string
  folderRoot?: string
  relativePath?: string
  sourceOrder: number
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
