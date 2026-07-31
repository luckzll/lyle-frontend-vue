import type { AttachmentSource, IncomingAttachmentFile } from '@/domain/chat-attachment'
import { DIRECTORY_SCAN_LIMITS, type DirectoryScanResult, type DirectorySkip } from '@/domain/directory-entry'

interface LegacyFileEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (success: (file: File) => void, failure?: () => void) => void
  createReader?: () => { readEntries: (success: (entries: LegacyFileEntry[]) => void, failure?: () => void) => void }
}

interface DirectoryDataTransferItem {
  kind: string
  getAsFile: () => File | null
  getAsEntry?: () => LegacyFileEntry | null
  webkitGetAsEntry?: () => LegacyFileEntry | null
}

interface ScanContext {
  files: IncomingAttachmentFile[]
  skipped: DirectorySkip[]
  deadline: number
  entries: number
  sourceOrder: number
  truncated: boolean
  signal?: AbortSignal
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export async function scanDataTransfer(dataTransfer: DataTransfer, signal?: AbortSignal): Promise<DirectoryScanResult> {
  const ctx = createContext(signal)
  const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === 'file') as unknown as DirectoryDataTransferItem[]

  if (!items.length) {
    return scanFlatFiles(Array.from(dataTransfer.files || []), 'drop')
  }

  for (const [index, item] of items.entries()) {
    if (guard(ctx, '其余顶层条目', undefined, items.length - index)) break
    const entry = item.getAsEntry?.() ?? item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      const groupId = newId()
      await readEntry(entry, ctx, 0, '', groupId, entry.name)
    } else if (entry?.isFile) {
      await readEntry(entry, ctx, 0, '', undefined, undefined)
    } else {
      const file = item.getAsFile()
      if (file) addFile(ctx, file, 'drop')
      else ctx.skipped.push({ name: entry?.name || '未知条目', reason: 'read_error' })
    }
  }
  return result(ctx)
}

export function scanPickerFiles(files: File[], source: 'picker' | 'paste' | 'folder_picker'): DirectoryScanResult {
  if (source !== 'folder_picker') return scanFlatFiles(files, source)

  const groups = new Map<string, { id: string; first: number; files: Array<{ file: File; path: string }> }>()
  const skipped: DirectorySkip[] = []
  files.slice(0, DIRECTORY_SCAN_LIMITS.maxEntries).forEach((file, index) => {
    const rawPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const path = normalizeRelativePath(rawPath)
    if (!path) {
      skipped.push({ name: file.name, reason: 'read_error' })
      return
    }
    const segments = path.split('/')
    const hidden = segments.find((segment) => segment.startsWith('.'))
    if (hidden) {
      skipped.push({ name: file.name, relativePath: path, reason: isSystem(hidden) ? 'system' : 'hidden' })
      return
    }
    if (segments.length - 2 > DIRECTORY_SCAN_LIMITS.maxDepth) {
      skipped.push({ name: file.name, relativePath: path, reason: 'depth' })
      return
    }
    const root = path.split('/')[0] || file.name
    const group = groups.get(root) || { id: newId(), first: index, files: [] }
    group.files.push({ file, path })
    groups.set(root, group)
  })
  if (files.length > DIRECTORY_SCAN_LIMITS.maxEntries) {
    skipped.push({
      name: '其余选择器条目',
      reason: 'scan_limit',
      count: files.length - DIRECTORY_SCAN_LIMITS.maxEntries
    })
  }

  const incoming: IncomingAttachmentFile[] = []
  for (const [root, group] of [...groups.entries()].sort((a, b) => a[1].first - b[1].first)) {
    group.files.sort((a, b) => naturalOrder.compare(a.path, b.path))
    for (const item of group.files) {
      incoming.push({
        file: item.file,
        sourceType: 'folder_picker',
        folderGroupId: group.id,
        folderRoot: root,
        relativePath: item.path,
        sourceOrder: incoming.length
      })
    }
  }
  return { files: incoming, skipped, truncated: files.length > DIRECTORY_SCAN_LIMITS.maxEntries }
}

export function scanFlatFiles(files: File[], source: Extract<AttachmentSource, 'picker' | 'drop' | 'paste'>): DirectoryScanResult {
  return {
    files: files.map((file, sourceOrder) => ({ file, sourceType: source, sourceOrder })),
    skipped: [],
    truncated: false
  }
}

export function normalizeRelativePath(raw: string): string | null {
  const value = raw.normalize('NFC').replace(/\\/g, '/')
  if (!value || value !== value.trim() || value.length > DIRECTORY_SCAN_LIMITS.maxPathLength || value.startsWith('/') || value.startsWith('//')) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > DIRECTORY_SCAN_LIMITS.maxSegmentLength)) return null
  return segments.join('/')
}

function createContext(signal?: AbortSignal): ScanContext {
  return { files: [], skipped: [], deadline: performance.now() + DIRECTORY_SCAN_LIMITS.timeoutMs, entries: 0, sourceOrder: 0, truncated: false, signal }
}

async function readEntry(
  entry: LegacyFileEntry,
  ctx: ScanContext,
  depth: number,
  parentPath: string,
  folderGroupId?: string,
  folderRoot?: string
) {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name
  if (isSystem(entry.name)) {
    ctx.skipped.push({ name: entry.name, relativePath, reason: 'system' })
    return
  }
  if (entry.name.startsWith('.')) {
    ctx.skipped.push({ name: entry.name, relativePath, reason: 'hidden' })
    return
  }
  if (depth > DIRECTORY_SCAN_LIMITS.maxDepth) {
    ctx.skipped.push({ name: entry.name, relativePath, reason: 'depth' })
    ctx.truncated = true
    return
  }
  if (guard(ctx, entry.name, relativePath)) return
  ctx.entries += 1

  if (entry.isFile && entry.file) {
    try {
      const file = await readFile(entry, ctx)
      const normalized = normalizeRelativePath(relativePath)
      if (!normalized) ctx.skipped.push({ name: entry.name, relativePath, reason: 'read_error' })
      else addFile(ctx, file, folderGroupId ? 'folder_drop' : 'drop', folderGroupId, folderRoot, normalized)
    } catch {
      ctx.skipped.push({ name: entry.name, relativePath, reason: 'read_error' })
    }
    return
  }

  if (!entry.isDirectory || !entry.createReader) {
    ctx.skipped.push({ name: entry.name, relativePath, reason: 'read_error' })
    return
  }

  let children: LegacyFileEntry[]
  try {
    children = await readBoundedEntries(entry.createReader(), ctx, entry.name, relativePath)
  } catch {
    if (!ctx.signal?.aborted && !ctx.truncated) ctx.skipped.push({ name: entry.name, relativePath, reason: 'read_error' })
    return
  }
  if (!children.length && !ctx.signal?.aborted && !ctx.truncated) {
    ctx.skipped.push({ name: entry.name, relativePath, reason: 'empty_directory' })
    return
  }
  children.sort((a, b) => naturalOrder.compare(a.name, b.name))
  for (const [index, child] of children.entries()) {
    if (guard(ctx, child.name, `${relativePath}/${child.name}`, children.length - index)) break
    await readEntry(child, ctx, depth + 1, relativePath, folderGroupId, folderRoot)
    if (ctx.entries > 0 && ctx.entries % 50 === 0) await yieldToBrowser()
  }
}

function guard(ctx: ScanContext, name = '其余条目', relativePath?: string, knownRemaining = 1): boolean {
  if (ctx.signal?.aborted) return true
  if (performance.now() >= ctx.deadline) {
    recordTruncation(ctx, 'timeout', name, relativePath, knownRemaining)
    return true
  }
  if (ctx.entries >= DIRECTORY_SCAN_LIMITS.maxEntries) {
    recordTruncation(ctx, 'scan_limit', name, relativePath, knownRemaining)
    return true
  }
  return false
}

function readFile(entry: LegacyFileEntry, ctx: ScanContext): Promise<File> {
  return callbackBeforeDeadline<File>(ctx, (resolve, reject) => entry.file?.(resolve, reject) ?? reject(new Error('not a file')))
}

/**
 * Enumerate at most the remaining scan budget. Calling readEntries in bounded
 * batches prevents a huge directory from being fully materialized before the
 * 500-entry / 5-second guards can run.
 */
async function readBoundedEntries(
  reader: ReturnType<NonNullable<LegacyFileEntry['createReader']>>,
  ctx: ScanContext,
  name: string,
  relativePath: string
): Promise<LegacyFileEntry[]> {
  const entries: LegacyFileEntry[] = []
  for (;;) {
    if (guard(ctx, name, relativePath)) return entries
    let batch: LegacyFileEntry[]
    try {
      batch = await callbackBeforeDeadline(ctx, (resolve, reject) => reader.readEntries(resolve, reject))
    } catch (error) {
      if (error instanceof ScanTimeoutError) {
        recordTruncation(ctx, 'timeout', name, relativePath, 1)
      }
      throw error
    }
    if (!batch.length) return entries
    const remaining = DIRECTORY_SCAN_LIMITS.maxEntries - ctx.entries - entries.length
    const accepted = Math.max(0, Math.min(remaining, batch.length))
    entries.push(...batch.slice(0, accepted))
    if (accepted < batch.length) {
      recordTruncation(ctx, 'scan_limit', batch[accepted]?.name || name, relativePath, batch.length - accepted)
      return entries
    }
    if (entries.length >= DIRECTORY_SCAN_LIMITS.maxEntries - ctx.entries) {
      // One extra bounded read distinguishes an exactly-full folder from one
      // that still has unread children without ever collecting the full tree.
      let overflow: LegacyFileEntry[]
      try {
        overflow = await callbackBeforeDeadline<LegacyFileEntry[]>(ctx, (resolve, reject) => reader.readEntries(resolve, reject))
      } catch (error) {
        if (error instanceof ScanTimeoutError) {
          recordTruncation(ctx, 'timeout', name, relativePath, 1)
        }
        throw error
      }
      if (overflow.length) recordTruncation(ctx, 'scan_limit', overflow[0]?.name || name, relativePath, overflow.length)
      return entries
    }
    if (entries.length > 0 && entries.length % 50 === 0) await yieldToBrowser()
  }
}

function callbackBeforeDeadline<T>(
  ctx: ScanContext,
  start: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (ctx.signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const remaining = Math.max(0, ctx.deadline - performance.now())
    if (!remaining) return reject(new ScanTimeoutError())
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ctx.signal?.removeEventListener('abort', abort)
      callback()
    }
    const timer = setTimeout(() => finish(() => reject(new ScanTimeoutError())), remaining)
    const abort = () => finish(() => reject(new DOMException('aborted', 'AbortError')))
    ctx.signal?.addEventListener('abort', abort, { once: true })
    try {
      start((value) => finish(() => resolve(value)), (reason) => finish(() => reject(reason)))
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

function recordTruncation(
  ctx: ScanContext,
  reason: 'scan_limit' | 'timeout',
  name: string,
  relativePath: string | undefined,
  count: number
) {
  ctx.truncated = true
  const normalizedCount = Math.max(1, count)
  const existing = ctx.skipped.find((item) => item.reason === reason && item.isMinimum)
  if (existing) {
    existing.count = Math.max(1, existing.count || 1) + normalizedCount
    return
  }
  ctx.skipped.push({ name, relativePath, reason, count: normalizedCount, isMinimum: true })
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

class ScanTimeoutError extends Error {}

function addFile(ctx: ScanContext, file: File, sourceType: AttachmentSource, folderGroupId?: string, folderRoot?: string, relativePath?: string) {
  ctx.files.push({ file, sourceType, folderGroupId, folderRoot, relativePath, sourceOrder: ctx.sourceOrder++ })
}

function isSystem(name: string) {
  return name === '.DS_Store' || name.toLowerCase() === 'thumbs.db'
}

function result(ctx: ScanContext): DirectoryScanResult {
  return { files: ctx.files, skipped: ctx.skipped, truncated: ctx.truncated }
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}
