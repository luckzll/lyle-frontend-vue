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
  maxProjectCount: 200,
  maxImages: 8,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  uploadConcurrency: 3
} as const

export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export const CHAT_FILE_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'log', 'xlsx',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'java', 'kt', 'kts', 'go', 'rs',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'yaml',
  'yml', 'toml', 'ini', 'cfg', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'graphql',
  'gql', 'proto', 'properties', 'gradle', 'scala', 'r', 'dart', 'ipynb'] as const
export const CHAT_EXACT_FILENAMES = ['Dockerfile', 'Makefile', 'Containerfile', 'Jenkinsfile', 'Procfile',
  'README', 'LICENSE', '.gitignore', '.dockerignore', '.editorconfig'] as const
export const ALLOWED_PROJECT_DOTFILES = new Set<string>(['.gitignore', '.dockerignore', '.editorconfig'])
export const CHAT_FILE_ACCEPT = [...CHAT_IMAGE_TYPES, ...CHAT_FILE_EXTENSIONS.map(extension => `.${extension}`)].join(',')

export function isChatImage(file: Pick<File, 'name'>) {
  return /\.(?:jpg|jpeg|png|webp|gif)$/i.test(file.name)
}

export function isSupportedChatFile(file: Pick<File, 'name' | 'type'>) {
  if (file.name.startsWith('.') && !ALLOWED_PROJECT_DOTFILES.has(file.name)) return false
  return isChatImage(file) || (CHAT_EXACT_FILENAMES as readonly string[]).includes(file.name)
    || (CHAT_FILE_EXTENSIONS as readonly string[]).includes(file.name.split('.').pop()?.toLowerCase() || '')
}

export function attachmentContentUrl(value?: string) {
  if (!value) return ''
  return value.startsWith('/chat/') ? `/api${value}` : value
}
