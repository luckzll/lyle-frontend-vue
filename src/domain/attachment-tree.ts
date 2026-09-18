import type { ChatAttachment, ChatAttachmentDraft } from './chat-attachment'
import { chatWireInteger } from './chat-wire'

export interface AttachmentTreeFile {
  id: string
  name: string
  path: string
  size: number
  status: string
  error?: string
}
export type AttachmentTreeNode = { type: 'file'; key: string; file: AttachmentTreeFile }
  | { type: 'folder'; key: string; name: string; children: AttachmentTreeNode[] }

export function attachmentTreeFiles(items: Array<ChatAttachment | ChatAttachmentDraft>): AttachmentTreeFile[] {
  return items.map(item => ({ id: 'localId' in item ? item.localId : item.id, name: item.name,
    path: item.relativePath || item.name, size: chatWireInteger(item.size) ?? 0,
    status: 'localId' in item ? item.status : 'attached', error: 'error' in item ? item.error : undefined }))
}

export function buildAttachmentTree(files: AttachmentTreeFile[], root: string): AttachmentTreeNode[] {
  const tree: AttachmentTreeNode[] = []
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    if (segments[0] === root) segments.shift()
    if (!segments.length) segments.push(file.name)
    let children = tree
    let path = ''
    for (const name of segments.slice(0, -1)) {
      path += `/${name}`
      let folder = children.find((node): node is Extract<AttachmentTreeNode, { type: 'folder' }> => node.type === 'folder' && node.key === path)
      if (!folder) { folder = { type: 'folder', key: path, name, children: [] }; children.push(folder) }
      children = folder.children
    }
    children.push({ type: 'file', key: file.id, file })
  }
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  function sort(nodes: AttachmentTreeNode[]) {
    nodes.sort((left, right) => left.type !== right.type ? left.type === 'folder' ? -1 : 1
      : order.compare(left.type === 'folder' ? left.name : left.file.name, right.type === 'folder' ? right.name : right.file.name))
    for (const node of nodes) if (node.type === 'folder') sort(node.children)
  }
  sort(tree)
  return tree
}

export function attachmentBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
