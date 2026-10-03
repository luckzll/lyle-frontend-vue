import type { WorkspaceCall, WorkspaceMessage } from './local-workspace'

const imageRead = (call: WorkspaceCall) => call.name === 'workspace_read' && typeof call.args.path === 'string' && /\.(png|jpe?g|webp)$/i.test(call.args.path)
const pathOf = (call: WorkspaceCall) => call.args.path as string
const append = (content: string, note: string) => content ? `${content}\n\n${note}` : note

/** One user turn owns this queue. Deferred writes never become automatic follow-up work. */
export class LocalWorkspaceImageBatches {
  private queued: WorkspaceCall[] = []
  private usedIds = new Set<string>()
  private stopped = false
  private sequence = 0
  private readonly idPrefix = `image-batch-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

  get pendingCount() { return this.queued.length }
  get pendingPaths() { return this.queued.map(pathOf) }
  cancel() { this.stopped = true; this.queued = []; this.usedIds.clear() }

  prepare(modelResult: WorkspaceMessage, history: WorkspaceMessage[] = []): WorkspaceMessage {
    if (this.stopped) throw new DOMException('图片读取批次已停止', 'AbortError')
    if (modelResult.role !== 'assistant') throw new Error('模型返回了无效的助手消息，已停止')
    const original = modelResult.tool_calls || []
    if (!Array.isArray(original) || original.length > 8) throw new Error('模型返回了无效的工具请求，已停止')
    const responseIds = new Set<string>()
    for (const call of original) {
      if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 150 || typeof call.name !== 'string' || !call.name
        || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) throw new Error('模型返回了无效的工具请求，已停止')
      if (responseIds.has(call.id)) throw new Error('模型返回了重复的工具调用标识，已停止')
      responseIds.add(call.id)
    }
    // The model's JSON remains untouched even when IDs change or a call is queued.
    const calls = structuredClone(original)
    for (const message of history) {
      for (const call of message.tool_calls || []) this.usedIds.add(call.id)
      if (message.tool_call_id) this.usedIds.add(message.tool_call_id)
    }
    let content = modelResult.content
    let scheduled: WorkspaceCall[]
    if (!calls.length && this.queued.length) {
      scheduled = this.queued.slice(0, 2)
      this.queued = this.queued.slice(scheduled.length)
      content = append(content, `自动继续原任务：本批实际读取以下 ${scheduled.length} 张尚未读取的图片，读取后再依据真实内容分析。\n`
        + scheduled.map(call => `- ${pathOf(call)}`).join('\n')
        + (this.queued.length ? `\n后续还有 ${this.queued.length} 张图片等待分批读取，尚未完成全部读取。` : '\n本轮图片仍需实际读取并分析，尚未完成。'))
    } else {
      let images = 0
      const cutoff = calls.findIndex(call => imageRead(call) && ++images > 2)
      scheduled = cutoff < 0 ? calls : calls.slice(0, cutoff)
      const scheduledPaths = new Set(scheduled.filter(imageRead).map(pathOf))
      this.queued = this.queued.filter(call => !scheduledPaths.has(pathOf(call)))
      if (cutoff >= 0) {
        const suffix = calls.slice(cutoff)
        const queuedPaths = new Set(this.queued.map(pathOf))
        for (const call of suffix) {
          if (!imageRead(call) || scheduledPaths.has(pathOf(call)) || queuedPaths.has(pathOf(call))) continue
          this.queued.push(call); queuedPaths.add(pathOf(call))
        }
        const omitted = suffix.filter(call => !imageRead(call))
        content = append(content, '图片将自动分批读取。本批最多读取 2 张。'
          + (this.queued.length ? `以下 ${this.queued.length} 张尚未读取，将在分析当前批次后继续：\n` + this.queued.map(call => `- ${pathOf(call)}`).join('\n') : '本批包含的重复图片请求不会再次排队。')
          + (omitted.length ? '\n本批后续的其他工具请求尚未执行，不会自动重放；请基于实际读取结果重新规划后续操作。' : ''))
      }
    }
    const emittedIds = new Set<string>()
    scheduled = scheduled.map(call => {
      let id = call.id
      // History accepts 128 characters, while the upstream tool API allows 150.
      if (id.length > 128 || this.usedIds.has(id) || emittedIds.has(id)) {
        do { id = `${this.idPrefix}-${++this.sequence}` } while (this.usedIds.has(id) || emittedIds.has(id))
      }
      emittedIds.add(id)
      return { ...call, id, args: structuredClone(call.args) }
    })
    for (const id of emittedIds) this.usedIds.add(id)
    return { ...modelResult, content, tool_calls: scheduled }
  }
}
