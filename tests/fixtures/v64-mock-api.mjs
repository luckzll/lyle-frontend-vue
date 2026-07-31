import http from 'node:http'

const port = Number(process.env.V64_MOCK_API_PORT || 8094)
const now = Math.floor(Date.now() / 1000)
const payload = Buffer.from(JSON.stringify({ sub: '42', exp: now + 3600 })).toString('base64url')
const accessToken = `eyJhbGciOiJub25lIn0.${payload}.v64-preview`

const user = {
  id: 42,
  username: 'Lyle',
  role: 'USER',
  status: 'ACTIVE',
  lastLoginAt: '2026-07-23T15:48:00+08:00'
}

const summary = {
  period: 'today',
  periodStart: '2026-07-23T00:00:00',
  periodEnd: '2026-07-24T00:00:00',
  totalTokens: 34280,
  inputTokens: 21640,
  outputTokens: 12640,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  callCount: 42,
  estimatedCostMicros: 860000,
  reportedRatio: 83.3,
  estimatedRatio: 16.7,
  measurementStatus: 'PARTIAL_ESTIMATE'
}

const policy = {
  dailySoftTokenLimit: 40000,
  dailyHardTokenLimit: 50000,
  dailySoftCostMicros: 800000,
  dailyHardCostMicros: 1200000,
  turnMaxCalls: 12,
  turnMaxInputTokens: 100000,
  turnMaxOutputTokens: 16000,
  turnMaxCostMicros: 200000,
  usedTokens: 34280,
  usedCostMicros: 860000,
  usedPercent: 68.6,
  remainingTokens: 15720,
  status: 'HEALTHY',
  resetsAt: '2026-07-24T00:00:00'
}

const tasks = [
  { taskType: 'CHAT', label: '对话回答', description: '用于日常对话与问题回答', totalTokens: 16800, estimatedCostMicros: 390000, callCount: 18 },
  { taskType: 'MEMORY', label: '记忆整理', description: '用于信息整理与归档总结', totalTokens: 9120, estimatedCostMicros: 210000, callCount: 11 },
  { taskType: 'REVIEWER', label: '审核与重写', description: '用于内容审核与优化重写', totalTokens: 5120, estimatedCostMicros: 160000, callCount: 7 },
  { taskType: 'INTENT', label: '意图识别', description: '用于识别用户意图与任务分类', totalTokens: 3240, estimatedCostMicros: 100000, callCount: 6 }
]

const trend = [
  { bucket: '08:00', totalTokens: 4200, callCount: 5 },
  { bucket: '10:00', totalTokens: 7600, callCount: 8 },
  { bucket: '12:00', totalTokens: 5100, callCount: 7 },
  { bucket: '14:00', totalTokens: 9800, callCount: 12 },
  { bucket: '16:00', totalTokens: 7580, callCount: 10 }
]

const turns = [
  { turnId: 'turn-1', conversationId: '1001', workTitle: '梳理 V6.4 发布范围', taskType: 'CHAT', taskLabel: '对话回答', totalTokens: 6840, estimatedCostMicros: 182000, callCount: 6, measurementSource: 'PROVIDER_REPORTED', occurredAt: '2026-07-23T16:12:00' },
  { turnId: 'turn-2', conversationId: '1002', workTitle: '总结账号会话方案', taskType: 'SUMMARY', taskLabel: '记忆整理', totalTokens: 4280, estimatedCostMicros: 116000, callCount: 4, measurementSource: 'PARTIAL_ESTIMATE', occurredAt: '2026-07-23T15:32:00' },
  { turnId: 'turn-3', conversationId: '1003', workTitle: '复核额度与用量口径', taskType: 'REVIEWER', taskLabel: '审核与重写', totalTokens: 3160, estimatedCostMicros: 84000, callCount: 3, measurementSource: 'ESTIMATED', occurredAt: '2026-07-23T14:18:00' }
]

function writeJson(response, body, status = 200, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  })
  response.end(JSON.stringify(body))
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)
  const path = url.pathname.replace(/^\/api/, '')

  if (request.method === 'POST' && path === '/auth/refresh') {
    writeJson(response, { user, accessToken, expiresInSeconds: 3600 }, 200, {
      'Set-Cookie': 'lyle_refresh=v64-preview; HttpOnly; SameSite=Lax; Path=/api/auth'
    })
    return
  }
  if (request.method === 'GET' && path === '/usage/summary') return writeJson(response, summary)
  if (request.method === 'GET' && path === '/usage/by-task') return writeJson(response, tasks)
  if (request.method === 'GET' && path === '/usage/trend') return writeJson(response, trend)
  if (request.method === 'GET' && path === '/usage/turns') return writeJson(response, turns)
  if (request.method === 'GET' && path === '/usage/policy') return writeJson(response, policy)
  if (request.method === 'PUT' && path === '/usage/policy') return writeJson(response, policy)
  if (request.method === 'GET' && path === '/users/me') return writeJson(response, user)
  if (request.method === 'GET' && path === '/auth/session') {
    return writeJson(response, {
      createdAt: '2026-07-23T15:48:00',
      lastUsedAt: '2026-07-23T16:12:00',
      expiresAt: '2026-08-22T15:48:00',
      current: true
    })
  }
  if (path === '/runtime-config') {
    return writeJson(response, {
      authLoginV63Enabled: true,
      chatWorkspaceDropEnabled: true,
      chatFolderAttachmentsEnabled: true
    })
  }
  if (path.includes('/reminders') || path.includes('/confirmations') || path.includes('/needs-attention')) {
    return writeJson(response, { items: [] })
  }
  writeJson(response, { items: [] })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`V6.4 mock API listening on http://127.0.0.1:${port}\n`)
})
