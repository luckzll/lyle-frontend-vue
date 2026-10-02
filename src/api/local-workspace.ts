import { getAuthToken, initializeAuth } from '@/auth'
import type { WorkspaceMessage } from '@/domain/local-workspace'
import type { ChatModelId } from '@/domain/chat-model'
import { MAX_WORKSPACE_CLIENT_BYTES, validateWorkspaceImages } from '@/domain/local-workspace-images'

export type WorkspaceMode = 'chat' | 'agent'
export interface WorkspaceStepOptions { mode?: WorkspaceMode; workspaceConnected?: boolean; modelId?: ChatModelId }

export function workspaceStepBody(messages: WorkspaceMessage[], options: WorkspaceStepOptions = {}) {
  for (const message of messages) validateWorkspaceImages(message.images, message.role)
  const body = JSON.stringify({ messages, mode: options.mode ?? 'agent', workspaceConnected: options.workspaceConnected ?? true, modelId: options.modelId })
  if (new TextEncoder().encode(body).length > MAX_WORKSPACE_CLIENT_BYTES) throw new Error('图片和对话上下文已满，请减少附件或新建当前项目的对话；文件和记录会保留')
  return body
}

export async function workspaceStep(messages: WorkspaceMessage[], signal: AbortSignal, onDelta: (text: string) => void, options: WorkspaceStepOptions = {}) {
  const body = workspaceStepBody(messages, options)
  if (!await initializeAuth()) throw new Error('请重新登录后连接本地项目')
  const token = getAuthToken()
  const response = await fetch('/api/local-workspace/step/stream', {
    method: 'POST', credentials: 'include', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body
  })
  if (!response.ok || !response.body) throw new Error(response.status === 401 ? '请重新登录后连接本地项目' : '模型服务暂不可用，请检查额度或稍后重试')
  const reader = response.body.getReader(); const decoder = new TextDecoder()
  let buffer = ''; let result: WorkspaceMessage | null = null
  const parse = () => {
    let at: number
    while ((at = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, at); buffer = buffer.slice(at + 2)
      const event = block.split('\n').find(l => l.startsWith('event:'))?.slice(6).trim()
      const text = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
      if (!text) continue
      const data = JSON.parse(text)
      if (event === 'error') throw new Error(String(data.message || '请求失败'))
      if (event === 'delta' && typeof data.text === 'string') onDelta(data.text)
      if (event === 'result') result = data as WorkspaceMessage
    }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true }); parse()
      if (buffer.length > 500_000) throw new Error('模型响应过大，已停止')
    }
    buffer += decoder.decode(); parse()
    if (!result) throw new Error('连接已中断；尚未收到完整模型结果')
    return result as WorkspaceMessage
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
