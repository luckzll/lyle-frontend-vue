import type { IncomingAttachmentFile } from '@/domain/chat-attachment'

export type DirectorySkipReason = 'hidden' | 'system' | 'unsupported' | 'depth' | 'scan_limit' | 'timeout' | 'read_error' | 'empty_directory' | 'count' | 'size' | 'total_size'

export interface DirectorySkip {
  name: string
  relativePath?: string
  reason: DirectorySkipReason
  /** Number of entries represented by this row. Aggregated truncation rows avoid
   * allocating one object per unread file in very large folders. */
  count?: number
  /** The browser stopped enumerating at the safety boundary, so more entries may exist. */
  isMinimum?: boolean
}

export interface DirectoryScanResult {
  files: IncomingAttachmentFile[]
  skipped: DirectorySkip[]
  truncated: boolean
}

export const DIRECTORY_SCAN_LIMITS = {
  maxDepth: 8,
  maxEntries: 500,
  timeoutMs: 5000,
  maxPathLength: 512,
  maxSegmentLength: 128
} as const

export const DIRECTORY_SKIP_LABELS: Record<DirectorySkipReason, string> = {
  hidden: '隐藏文件',
  system: '系统文件',
  unsupported: '类型不支持',
  depth: '超过目录深度限制',
  scan_limit: '超过扫描条目限制',
  timeout: '扫描超时',
  read_error: '读取失败',
  empty_directory: '空文件夹',
  count: '超过数量限制',
  size: '超过单文件大小限制',
  total_size: '超过单轮总量限制'
}

export function directorySkippedCount(skipped: DirectorySkip[]) {
  return skipped.reduce((total, item) => total + Math.max(1, item.count || 1), 0)
}
