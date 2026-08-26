export const KNOWLEDGE_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.log',
  '.pdf',
  '.docx',
  '.xlsx',
  '.xlsm',
  '.xls',
  '.pptx'
] as const

export const KNOWLEDGE_FILE_ACCEPT = KNOWLEDGE_FILE_EXTENSIONS.join(',')

export function knowledgeFileExtension(fileName: string) {
  const normalized = String(fileName || '').trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ''
}

export function isKnowledgeFileSupported(fileName: string) {
  return KNOWLEDGE_FILE_EXTENSIONS.includes(
    knowledgeFileExtension(fileName) as (typeof KNOWLEDGE_FILE_EXTENSIONS)[number]
  )
}
