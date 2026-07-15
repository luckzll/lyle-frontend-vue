import { onBeforeUnmount, ref } from 'vue'
import { getAuthToken } from '@/auth'
import type { AgentTaskEvent } from '@/api/agentTasks'

export function useAgentTaskEvents(onEvent: (event: AgentTaskEvent) => void | Promise<void>) {
  const connected = ref(false)
  const lastSequence = ref(0)
  let controller: AbortController | null = null
  let reconnectTimer: number | null = null
  let taskId: string | null = null
  let retryCount = 0

  function connect(id: string | number) {
    disconnect()
    taskId = String(id)
    controller = new AbortController()
    void consume(taskId, controller.signal)
  }

  function disconnect() {
    taskId = null
    connected.value = false
    controller?.abort()
    controller = null
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  async function consume(id: string, signal: AbortSignal) {
    try {
      const token = getAuthToken()
      const response = await fetch(`/api/agent-tasks/${id}/events?after=${lastSequence.value}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal
      })
      if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`)
      connected.value = true
      retryCount = 0
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!signal.aborted) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          await handleFrame(frame)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (signal.aborted) return
    } finally {
      connected.value = false
      if (!signal.aborted && taskId === id) scheduleReconnect(id)
    }
  }

  async function handleFrame(frame: string) {
    let eventName = 'message'
    let id = 0
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('id:')) id = Number(line.slice(3).trim()) || 0
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (eventName === 'heartbeat' || !data.length) return
    const parsed = JSON.parse(data.join('\n')) as AgentTaskEvent
    const sequence = Number(parsed.sequence || id)
    if (!Number.isFinite(sequence) || sequence <= 0) return
    if (sequence <= lastSequence.value) return
    lastSequence.value = sequence
    await onEvent(parsed)
  }

  function scheduleReconnect(id: string) {
    retryCount += 1
    const delay = Math.min(15_000, 500 * 2 ** Math.min(retryCount, 5))
    reconnectTimer = window.setTimeout(() => {
      if (taskId !== id) return
      controller = new AbortController()
      void consume(id, controller.signal)
    }, delay)
  }

  onBeforeUnmount(disconnect)
  return { connected, lastSequence, connect, disconnect }
}
