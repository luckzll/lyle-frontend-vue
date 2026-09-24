export type LocalProjectRouteRequest = {
  projectId: string | null
  sessionId: string | null
  action: 'new-chat' | 'add-project' | 'delete-project' | 'delete-session' | null
  request: string | null
  error: string | null
}

export function parseLocalProjectRoute(query: Record<string, unknown>): LocalProjectRouteRequest {
  const result: LocalProjectRouteRequest = { projectId: null, sessionId: null, action: null, request: null, error: null }
  for (const key of ['projectId', 'sessionId', 'action', 'request'] as const) {
    const value = query[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !value.trim() || value.length > 256) return { ...result, action: null, error: '项目链接参数无效，请从侧栏重新打开' }
    if (key === 'action') {
      if (!['new-chat', 'add-project', 'delete-project', 'delete-session'].includes(value)) return { ...result, error: '项目链接操作无效，请从侧栏重新打开' }
      result.action = value as LocalProjectRouteRequest['action']
    } else result[key] = value
  }
  if (result.action && !result.request) result.error = '项目操作链接已失效，请从侧栏重新发起'
  else if (result.action === 'new-chat' && !result.projectId) result.error = '请先选择要新建对话的项目'
  else if (result.action === 'delete-project' && !result.projectId) result.error = '请先选择要删除的项目'
  else if (result.action === 'delete-session' && !result.sessionId) result.error = '请先选择要删除的对话'
  else if (result.action && result.action !== 'delete-session' && result.sessionId) result.error = '项目操作链接参数冲突，请从侧栏重新发起'
  if (result.error) result.action = null
  return result
}

export function canonicalLocalProjectQuery(projectId: string | null, sessionId: string | null): Record<string, string> {
  return { ...(projectId ? { projectId } : {}), ...(sessionId ? { sessionId } : {}) }
}
