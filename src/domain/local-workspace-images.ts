export const MAX_WORKSPACE_IMAGES = 2
export const MAX_WORKSPACE_IMAGE_URI = 65_536
export const MAX_WORKSPACE_BODY_BYTES = 220_000
// Java adds model configuration and usage reservation fields before forwarding.
export const MAX_WORKSPACE_CLIENT_BYTES = 200_000

/** Keep newly read pixels until the model has responded. Older image payloads
 * can then leave model context while paths, text, tool replies and UI history stay.
 */
export function compactWorkspaceImageHistory<T extends { role: string; content: string; images?: string[] }>(messages: T[], limit = 190_000): T[] {
  const result = [...messages]
  const bytes = () => new TextEncoder().encode(JSON.stringify(result)).length
  for (let index = 0; index < result.length && bytes() > limit; index++) {
    const message = result[index]!
    if (message.role !== 'user' || !message.images?.length || !result.slice(index + 1).some(item => item.role === 'assistant')) continue
    result[index] = { ...message, images: [], content: message.content
      + '\n[较早的图片已从模型上下文移除，文字与已返回结果保留。需要再次查看文件图片时，请重新调用 workspace_read；直接上传的图片请用户重新添加。]' }
  }
  return result
}

export type WorkspaceReadImage = { path: string; image: string }
/** Tool replies stay textual. The actual pixels enter a subsequent user image message. */
export function workspaceImageToolResult(value: unknown): { result: unknown; image?: WorkspaceReadImage } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { result: value }
  const row = value as Record<string, unknown>
  if (row.kind !== 'image') return { result: value }
  if (typeof row.path !== 'string' || !row.path || typeof row.image !== 'string') throw new Error('图片读取结果无效')
  validateWorkspaceImages([row.image], 'user')
  return { result: { kind: 'image', path: row.path, status: 'read', message: '图片已读取，将提供给模型分析；图片内容尚未完成识别',
    ...(typeof row.width === 'number' ? { width: row.width } : {}), ...(typeof row.height === 'number' ? { height: row.height } : {}) },
    image: { path: row.path, image: row.image } }
}
export function workspaceReadImageMessage(images: WorkspaceReadImage[]) {
  if (!images.length) return undefined
  validateWorkspaceImages(images.map(item => item.image), 'user')
  return { role: 'user' as const, content: '以下图片来自刚才通过 workspace_read 读取的已授权文件。路径仅用于对应图片，请根据真实图片继续处理原用户任务；先简述本批图片的可见内容，再按需读取下一批。不要声称未执行的修改已完成。\n'
    + images.map((item, index) => `${index + 1}. ${item.path}`).join('\n'), images: images.map(item => item.image) }
}

/** Only bounded inline PNG/JPEG/WebP images may enter local conversation history. */
export function validateWorkspaceImages(value: unknown, role: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_WORKSPACE_IMAGES || (role !== 'user' && value.length)) throw new Error('图片附件格式无效')
  for (const uri of value) {
    if (typeof uri !== 'string' || uri.length > MAX_WORKSPACE_IMAGE_URI
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(uri)) throw new Error('图片附件需为压缩后的 PNG、JPEG 或 WebP')
    const encoded = uri.slice(uri.indexOf(',') + 1)
    if (encoded.length % 4) throw new Error('图片附件编码无效')
    let bytes: string
    try { bytes = atob(encoded) } catch { throw new Error('图片附件编码无效') }
    const png = uri.startsWith('data:image/png;') && bytes.startsWith('\x89PNG\r\n\x1a\n')
    const jpeg = uri.startsWith('data:image/jpeg;') && bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9')
    const webp = uri.startsWith('data:image/webp;') && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
    if (!png && !jpeg && !webp) throw new Error('图片内容与格式不匹配')
  }
  return [...value] as string[]
}

export async function compressWorkspaceImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('请添加 10 MB 以内的 PNG、JPEG 或 WebP 图片')
  const url = URL.createObjectURL(file)
  try {
    const picture = new Image()
    picture.src = url
    await picture.decode()
    if (!picture.naturalWidth || !picture.naturalHeight || picture.naturalWidth * picture.naturalHeight > 40_000_000) throw new Error('图片尺寸过大，请缩小后添加')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片附件')
    let edge = 1024
    for (let attempt = 0; attempt < 6; attempt++) {
      const ratio = Math.min(1, edge / Math.max(picture.naturalWidth, picture.naturalHeight))
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * ratio))
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * ratio))
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(picture, 0, 0, canvas.width, canvas.height)
      const uri = canvas.toDataURL('image/jpeg', .72)
      if (uri.length <= MAX_WORKSPACE_IMAGE_URI) { validateWorkspaceImages([uri], 'user'); return uri }
      edge = Math.floor(edge * .7)
    }
    throw new Error('图片压缩后仍过大，请缩小或裁剪后添加')
  } finally { URL.revokeObjectURL(url) }
}
