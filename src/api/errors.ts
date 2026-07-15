import axios from 'axios'

export type AppError = {
  code: string
  title: string
  message: string
  retryable: boolean
  traceId?: string
}

export function toAppError(error: unknown, fallback = '请求未完成，请稍后重试。'): AppError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as Record<string, unknown> | undefined
    const status = error.response?.status
    return {
      code: String(data?.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR')),
      title: status && status >= 500 ? '服务暂时不可用' : '操作未完成',
      message: String(data?.message || data?.detail || error.message || fallback),
      retryable: !status || status >= 500 || status === 408 || status === 429,
      traceId: typeof data?.traceId === 'string' ? data.traceId : undefined
    }
  }
  return {
    code: 'UNKNOWN_ERROR',
    title: '操作未完成',
    message: error instanceof Error ? error.message : fallback,
    retryable: true
  }
}
