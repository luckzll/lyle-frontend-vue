export function attachmentRequestError(exception: unknown) {
  const response = (exception as { response?: { status?: number; data?: unknown } })?.response
  if (response?.status === 413) return '上传被服务器的大小限制拦截。单个附件支持 5MB 以内；若文件未超限，请稍后重试。'
  if (response?.status === 401) return '登录已过期，请重新登录后上传。'
  if (response?.status === 403) return '没有上传权限，请检查账号状态。'
  if (response?.status && response.status >= 500) return '附件上传服务暂时不可用，请稍后重试。'
  const data = response?.data
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
  const value = record?.detail || record?.message || record?.error || (typeof data === 'string' ? data : '')
  const safeText = (value: unknown) => typeof value === 'string' && value.trim() && !/<[!/a-z][\s\S]*>/i.test(value) ? value.trim().slice(0, 180) : ''
  return safeText(value) || (!response ? safeText(exception instanceof Error ? exception.message : '') : '') || '附件上传失败，请重试。'
}
