export const WORKSPACE_DOCUMENT_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'pptx'] as const
export const MAX_WORKSPACE_DOCUMENT_BYTES = 5 * 1024 * 1024
export const MAX_WORKSPACE_DOCUMENT_CHARS = 120_000
export const WORKSPACE_DOCUMENT_ACCEPT = WORKSPACE_DOCUMENT_EXTENSIONS.map(extension => `.${extension}`).join(',')
export function documentName(name: string) { return /\.(pdf|docx|xlsx|xlsm|xls|pptx)$/i.test(name) }
export interface WorkspaceDocumentText { text: string; format: string; truncated: boolean; warnings: string[] }
export type WorkspaceDocumentExtractor = (file: File, signal: AbortSignal) => Promise<WorkspaceDocumentText>
