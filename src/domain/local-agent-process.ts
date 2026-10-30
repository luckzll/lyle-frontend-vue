import type { LocalActivity } from './local-workspace-history'

export type LocalActivityDisplayStatus = LocalActivity['status'] | 'interrupted' | 'rejected'

const rejectedWriteDetail = '已拒绝，文件未修改'
const writeLabels = new Set(['修改文件', '新建文件'])

/** Presentation only: saved activity statuses and file-operation outcomes remain unchanged. */
export function localActivityDisplayStatus(activity: LocalActivity, active: boolean): LocalActivityDisplayStatus {
  if (activity.status === 'done' && writeLabels.has(activity.label) && activity.detail?.trim() === rejectedWriteDetail) return 'rejected'
  if ((activity.status === 'running' || activity.status === 'waiting') && !active) return 'interrupted'
  if (activity.status === 'error' && activity.label.includes('已停止')) return 'interrupted'
  return activity.status
}

const stepFeedback: Record<string, { running: string; done: string }> = {
  分析下一步: {
    running: '正在结合当前请求和已有信息，确定下一步操作。',
    done: '本步分析已结束，后续操作请见执行记录。',
  },
  查看目录: {
    running: '正在获取目录项，返回后会显示本次查看范围。',
    done: '本次目录查看已结束。',
  },
  读取文件: {
    running: '正在读取文件内容，返回后会显示本次读取范围。',
    done: '本次文件读取已结束。',
  },
  搜索项目: {
    running: '正在搜索项目，返回后会显示本次结果及搜索范围限制。',
    done: '本次项目搜索已结束。',
  },
  修改文件: {
    running: '正在处理文件修改请求，写入结果将在操作返回后显示。',
    done: '修改步骤已结束，未提供写入结果详情。',
  },
  新建文件: {
    running: '正在处理新建文件请求，写入结果将在操作返回后显示。',
    done: '新建步骤已结束，未提供写入结果详情。',
  },
}

function withDetail(prefix: string, detail: string): string {
  return detail ? `${prefix}\n${detail}` : prefix
}

/** Show real commentary first; fallbacks describe status without inventing operation results. */
export function localActivityFeedback(activity: LocalActivity, displayStatus: LocalActivityDisplayStatus): string {
  const detail = activity.detail?.trim() ? activity.detail : ''
  if (displayStatus === 'interrupted') return withDetail('本轮已停止，此步骤未完成。', detail)
  if (displayStatus === 'error') return withDetail('此步骤未能完成。', detail)
  if (displayStatus === 'waiting') return withDetail(writeLabels.has(activity.label) ? '等待你确认这项修改，文件尚未写入。' : '等待你确认这项工具操作，尚未执行。', detail)
  if (displayStatus === 'rejected') return detail || rejectedWriteDetail
  if (detail) return detail
  return stepFeedback[activity.label]?.[displayStatus] || (displayStatus === 'running' ? '正在处理此步骤，结果尚未返回。' : '此步骤已结束，未提供结果详情。')
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function directoryEntry(value: unknown): boolean {
  const row = record(value)
  return !!row && typeof row.name === 'string' && typeof row.path === 'string' && (row.kind === 'file' || row.kind === 'directory')
}

function searchMatch(value: unknown): boolean {
  const row = record(value)
  return !!row && typeof row.path === 'string' && typeof row.text === 'string' && count(row.line) && row.line > 0
}

/** Summarize only the actual executeRead payload, including partial-result boundaries. */
export function localReadFeedback(name: string, result: unknown): string {
  const row = record(result)
  if (name === 'workspace_list' && Array.isArray(row?.entries) && row.entries.every(directoryEntry)) {
    const notes = [`本次返回 ${row.entries.length} 个目录项。`]
    if (count(row.nextOffset)) notes.push('可继续分页查看后续目录项。')
    if (row.scanCapped === true) notes.push('已达到目录扫描上限，结果可能不完整。')
    return notes.join(' ')
  }
  if (name === 'workspace_read' && typeof row?.content === 'string') {
    const total = count(row.totalChars) && row.totalChars >= row.content.length ? `（文件共 ${row.totalChars} 个字符）` : ''
    const notes = [`本次返回 ${row.content.length} 个字符${total}。`]
    if (count(row.nextOffset)) notes.push('仍有后续内容可继续读取。')
    if (row.kind === 'document') {
      if (row.truncated === true) notes.push('文档达到解析上限，返回内容不完整。')
      if (Array.isArray(row.warnings)) for (const warning of row.warnings) if (typeof warning === 'string') notes.push(warning)
    }
    return notes.join(' ')
  }
  if (name === 'workspace_read' && row?.kind === 'image' && typeof row.image === 'string') {
    return '已读取并压缩图片，接下来交给模型识别。原图片未修改。'
  }
  if (name === 'workspace_search' && Array.isArray(row?.matches) && row.matches.every(searchMatch)) {
    const notes = [`本次返回 ${row.matches.length} 条匹配。`]
    if (row.truncated === true) notes.push('搜索已达到限制，结果可能不完整。')
    if (count(row.skipped) && row.skipped > 0) notes.push(`另有 ${row.skipped} 个文件未能读取，已跳过。`)
    return notes.join(' ')
  }
  return '此步骤未提供可展示的结果摘要。'
}
