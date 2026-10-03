import { getAuthToken, initializeAuth } from '@/auth'
import { documentName, MAX_WORKSPACE_DOCUMENT_BYTES, MAX_WORKSPACE_DOCUMENT_CHARS, type WorkspaceDocumentText } from '@/domain/local-workspace-documents'

/** Stateless parsing only: no ordinary chat upload or cross-project attachment storage. */
export async function extractWorkspaceDocument(file: File, signal: AbortSignal): Promise<WorkspaceDocumentText> {
  signal.throwIfAborted()
  if (!documentName(file.name)) throw new Error('支持 PDF、DOCX、XLSX、XLSM、XLS 和 PPTX；旧版 DOC/PPT 请先转换')
  if (!file.size || file.size > MAX_WORKSPACE_DOCUMENT_BYTES) throw new Error('文档需在 5 MB 以内，且不能为空')
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  const blocks: string[] = []
  // Chunk on a multiple of three so individually encoded blocks concatenate exactly.
  for (let at = 0; at < bytes.length; at += 12288) blocks.push(btoa(String.fromCharCode(...bytes.subarray(at, at + 12288))))
  if (!await initializeAuth()) throw new Error('请重新登录后读取文档')
  signal.throwIfAborted()
  const token = getAuthToken()
  const response = await fetch('/api/local-workspace/document/extract', {
    method: 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ name: file.name, data: blocks.join('') })
  })
  if (!response.ok) throw new Error(response.status === 401 ? '请重新登录后读取文档' : response.status === 413 ? '文档超过 5 MB 读取限制'
    : response.status === 429 ? '文档读取过于频繁，请稍后重试' : response.status >= 500 ? '文档解析服务暂不可用，请稍后重试'
    : '文档无法解析，可能已损坏、加密或格式不符')
  const result = await response.json() as WorkspaceDocumentText
  signal.throwIfAborted()
  if (typeof result.text !== 'string' || result.text.length > MAX_WORKSPACE_DOCUMENT_CHARS || typeof result.format !== 'string'
    || typeof result.truncated !== 'boolean' || !Array.isArray(result.warnings) || result.warnings.length > 8
    || result.warnings.some(warning => typeof warning !== 'string' || warning.length > 500)) throw new Error('文档解析响应无效')
  return result
}
