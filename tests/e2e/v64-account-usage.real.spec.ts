import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  test,
} from '@playwright/test'

test.skip(
  process.env.V64_REAL_E2E !== '1',
  'Set V64_REAL_E2E=1 to run the V6.4 two-user matrix against isolated MySQL/PostgreSQL databases.',
)
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4176'
const origin = new URL(baseURL).origin
const originalPassword = 'v64-real-password'
const changedPassword = 'v64-real-password-updated'

type Identity = {
  context: BrowserContext
  page: Page
  id: string
  username: string
  password: string
  token: string
}

type ApiResult = {
  status: number
  body: any
  text: string
}

test('real backend keeps two users isolated across sessions, resources and AI usage', async ({ browser }) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`
  const userA = await register(browser, `v64_real_a_${suffix}`)
  const userB = await register(browser, `v64_real_b_${suffix}`)

  try {
    await test.step('HttpOnly refresh restores the account after navigation and reload', async () => {
      await userA.page.goto('/settings/usage')
      await expect(userA.page).toHaveURL(/\/settings\/usage$/)
      await expect(userA.page.getByText(userA.username, { exact: true }).first()).toBeVisible()
      await userA.page.reload()
      await expect(userA.page).toHaveURL(/\/settings\/usage$/)
      await expect(userA.page.getByText(userA.username, { exact: true }).first()).toBeVisible()
      await expect(userA.page.evaluate(() => localStorage.getItem('lyle-token'))).resolves.toBeNull()
    })

    const conversation = await expectOk(await api(userA, '/api/conversations', {
      method: 'POST',
      data: { title: `A private conversation ${suffix}` },
    }))
    const attachment = await expectOk(await api(userA, '/api/chat/attachments', {
      method: 'POST',
      multipart: {
        file: {
          name: `private-${suffix}.txt`,
          mimeType: 'text/plain',
          buffer: Buffer.from(`private attachment ${suffix}`, 'utf8'),
        },
      },
    }))
    const knowledgeBase = await expectOk(await api(userA, '/api/knowledge-bases', {
      method: 'POST',
      data: { name: `A private knowledge ${suffix}` },
    }))
    const memoryKey = `private_note_${suffix}`
    await expectOk(await api(userA, '/api/memory/structured', {
      method: 'PUT',
      data: {
        key: memoryKey,
        value: `A memory ${suffix}`,
        confidence: 1,
        status: 'active',
        source: 'v64-real-e2e',
      },
    }))
    const todo = await expectOk(await api(userA, '/api/agent-tools/todos', {
      method: 'POST',
      data: { title: `A private todo ${suffix}` },
    }))
    const mission = await expectOk(await api(userA, '/api/missions', {
      method: 'POST',
      idempotencyKey: `v64-mission-${suffix}`,
      data: {
        title: `A private mission ${suffix}`,
        goal: `持续调研 V6.4 双用户隔离 ${suffix}`,
        templateId: 'research-weekly',
        validityDays: 30,
      },
    }))

    await test.step('conversation, attachment, knowledge, memory, task and Mission stay user-scoped', async () => {
      const bConversations = await expectOk(await api(userB, '/api/conversations'))
      expect(bConversations.map((item: any) => String(item.id))).not.toContain(String(conversation.id))
      expect((await api(userB, `/api/conversations/${conversation.id}`, {
        method: 'PATCH',
        data: { title: 'cross-user mutation' },
      })).status).toBe(404)

      const ownAttachment = await api(userA, `/api/chat/attachments/${attachment.id}/content`)
      expect(ownAttachment.status).toBe(200)
      expect(ownAttachment.text).toBe(`private attachment ${suffix}`)
      expect((await api(userB, `/api/chat/attachments/${attachment.id}/content`)).status).toBe(404)

      const bKnowledgeBases = await expectOk(await api(userB, '/api/knowledge-bases'))
      expect(bKnowledgeBases.map((item: any) => String(item.id))).not.toContain(String(knowledgeBase.id))
      expect((await api(userB, `/api/knowledge-bases/${knowledgeBase.id}`, {
        method: 'DELETE',
      })).status).toBe(404)

      const aMemory = await expectOk(await api(userA, '/api/memory/current'))
      const bMemory = await expectOk(await api(userB, '/api/memory/current'))
      expect(JSON.stringify(aMemory)).toContain(`A memory ${suffix}`)
      expect(JSON.stringify(bMemory)).not.toContain(`A memory ${suffix}`)
      const bMemoryHistory = await expectOk(await api(
        userB,
        `/api/memory/structured/${encodeURIComponent(memoryKey)}/history`,
      ))
      expect(bMemoryHistory.items).toHaveLength(0)

      const aTodos = await expectOk(await api(userA, '/api/agent-tools/todos?limit=100'))
      const bTodos = await expectOk(await api(userB, '/api/agent-tools/todos?limit=100'))
      expect(aTodos.items.map((item: any) => String(item.id))).toContain(String(todo.id))
      expect(bTodos.items.map((item: any) => String(item.id))).not.toContain(String(todo.id))
      expect((await api(userB, `/api/agent-tools/todos/${todo.id}/status`, {
        method: 'PATCH',
        data: { status: 'done' },
      })).status).toBe(404)
      const aTodosAfterCrossWrite = await expectOk(await api(userA, '/api/agent-tools/todos?limit=100'))
      expect(aTodosAfterCrossWrite.items.find((item: any) => String(item.id) === String(todo.id))?.status).toBe('open')

      const bMissions = await expectOk(await api(userB, '/api/missions?limit=100'))
      expect(bMissions.items.map((item: any) => String(item.id))).not.toContain(String(mission.id))
      expect((await api(userB, `/api/missions/${mission.id}`)).status).toBe(404)
    })

    const aTurnId = `turn-a-${suffix}`
    const bTurnId = `turn-b-${suffix}`
    const usageBatch = await expectOk(await rawApi(userA.context.request, '/api/internal/ai-usage/events:batch', {
      method: 'POST',
      headers: { 'X-Usage-Internal-Token': process.env.V64_REAL_USAGE_TOKEN || '' },
      data: {
        events: [
          usageEvent(`event-a-${suffix}`, userA.id, String(conversation.id), aTurnId, 600, 400),
          usageEvent(`event-b-${suffix}`, userB.id, null, bTurnId, 120, 80),
        ],
      },
    }))
    expect(usageBatch).toMatchObject({ accepted: 2, rejected: 0 })

    await test.step('usage details and quota enforcement are isolated by user', async () => {
      const aSummary = await expectOk(await api(userA, '/api/usage/summary?period=today'))
      const bSummary = await expectOk(await api(userB, '/api/usage/summary?period=today'))
      expect(Number(aSummary.totalTokens)).toBe(1000)
      expect(Number(bSummary.totalTokens)).toBe(200)
      expect((await api(userB, `/api/usage/turns/${aTurnId}`)).status).toBe(404)

      const aPolicy = await expectOk(await api(userA, '/api/usage/policy', {
        method: 'PUT',
        data: {
          dailySoftTokenLimit: 800,
          dailyHardTokenLimit: 1000,
          dailySoftCostMicros: 8_000_000,
          dailyHardCostMicros: 10_000_000,
        },
      }))
      const bPolicy = await expectOk(await api(userB, '/api/usage/policy'))
      expect(aPolicy.status).toBe('EXHAUSTED')
      expect(bPolicy.status).toBe('HEALTHY')

      const exhausted = await api(userA, '/api/chat/send', {
        method: 'POST',
        data: {
          conversationId: String(conversation.id),
          turnId: `quota-blocked-${suffix}`,
          message: 'This call must be blocked before reaching the model.',
          knowledgeBaseIds: [],
          attachmentIds: [],
        },
      })
      expect(exhausted.status).toBe(429)
      expect((await expectOk(await api(userB, '/api/usage/policy'))).status).toBe('HEALTHY')
    })

    await test.step('normal accounts cannot access admin APIs', async () => {
      expect((await api(userA, '/api/admin/overview')).status).toBe(403)
      expect((await api(userB, '/api/admin/overview')).status).toBe(403)
    })

    await test.step('password change revokes other A sessions and leaves B untouched', async () => {
      const userASecondSession = await login(browser, userA.username, userA.password)
      const stalePrimaryToken = userA.token
      try {
        const changed = await expectOk(await api(userA, '/api/auth/change-password', {
          method: 'POST',
          data: { currentPassword: originalPassword, newPassword: changedPassword },
        }))
        userA.token = changed.accessToken
        userA.password = changedPassword

        expect((await rawApi(userA.context.request, '/api/users/me', {
          headers: bearer(stalePrimaryToken),
        })).status).toBe(401)
        expect((await api(userASecondSession, '/api/users/me')).status).toBe(401)
        expect((await api(userB, '/api/users/me')).status).toBe(200)
        expect((await api(userA, '/api/users/me')).status).toBe(200)
      } finally {
        await userASecondSession.context.close()
      }
    })

    await expectOk(await api(userA, `/api/chat/attachments/${attachment.id}`, { method: 'DELETE' }))
    await userA.page.waitForTimeout(1_000)

    await test.step('refresh replay revokes only the replayed token family', async () => {
      const oldRefresh = await refreshCookie(userA.context)
      const rotated = await refresh(userA.context)
      expect(rotated.status).toBe(200)
      userA.token = rotated.body.accessToken
      expect(await refreshCookie(userA.context)).not.toBe(oldRefresh)

      const replayContext = await playwrightRequest.newContext({
        baseURL,
        extraHTTPHeaders: {
          Origin: origin,
          Cookie: `lyle_refresh=${oldRefresh}`,
        },
      })
      try {
        const replay = await rawApi(replayContext, '/api/auth/refresh', { method: 'POST' })
        expect(replay.status).toBe(401)
      } finally {
        await replayContext.dispose()
      }

      expect((await refresh(userA.context)).status).toBe(401)
      expect((await refresh(userB.context)).status).toBe(200)
    })
  } finally {
    await Promise.allSettled([userA.context.close(), userB.context.close()])
  }
})

async function register(browser: Browser, username: string): Promise<Identity> {
  const context = await browser.newContext({ baseURL })
  const response = await rawApi(context.request, '/api/auth/register', {
    method: 'POST',
    data: { username, password: originalPassword },
  })
  const body = await expectOk(response)
  return {
    context,
    page: await context.newPage(),
    id: String(body.user.id),
    username,
    password: originalPassword,
    token: body.accessToken,
  }
}

async function login(browser: Browser, username: string, password: string): Promise<Identity> {
  const context = await browser.newContext({ baseURL })
  const response = await rawApi(context.request, '/api/auth/login', {
    method: 'POST',
    data: { username, password },
  })
  const body = await expectOk(response)
  return {
    context,
    page: await context.newPage(),
    id: String(body.user.id),
    username,
    password,
    token: body.accessToken,
  }
}

async function api(identity: Identity, path: string, options: RequestOptions = {}): Promise<ApiResult> {
  return rawApi(identity.context.request, path, {
    ...options,
    headers: {
      ...bearer(identity.token),
      ...options.headers,
    },
  })
}

type RequestOptions = {
  method?: string
  headers?: Record<string, string>
  data?: unknown
  multipart?: Record<string, string | number | boolean | {
    name: string
    mimeType: string
    buffer: Buffer
  }>
  idempotencyKey?: string
}

async function rawApi(
  request: APIRequestContext,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult> {
  const response = await request.fetch(path, {
    method: options.method || 'GET',
    headers: {
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...options.headers,
    },
    data: options.data,
    multipart: options.multipart,
    failOnStatusCode: false,
  })
  const text = await response.text()
  let body: any = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status(), body, text }
}

async function expectOk(result: ApiResult): Promise<any> {
  expect(result.status, result.text).toBeGreaterThanOrEqual(200)
  expect(result.status, result.text).toBeLessThan(300)
  return result.body
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function refresh(context: BrowserContext) {
  return rawApi(context.request, '/api/auth/refresh', {
    method: 'POST',
    headers: { Origin: origin },
  })
}

async function refreshCookie(context: BrowserContext) {
  const cookie = (await context.cookies()).find((item) => item.name === 'lyle_refresh')
  expect(cookie?.value).toBeTruthy()
  return cookie!.value
}

function usageEvent(
  eventId: string,
  userId: string,
  conversationId: string | null,
  turnId: string,
  inputTokens: number,
  outputTokens: number,
) {
  return {
    eventId,
    userId,
    conversationId,
    turnId,
    traceId: `trace-${eventId}`,
    reservationId: null,
    callType: 'LLM_TEXT',
    taskType: 'CHAT',
    provider: 'v64-real',
    model: 'fixture-model',
    routeVersion: 'v6.4-real',
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usageSource: 'PROVIDER_REPORTED',
    estimatedCostMicros: inputTokens + outputTokens,
    pricingVersion: '2026-07-23',
    currency: 'CNY',
    latencyMillis: 10,
    status: 'SUCCEEDED',
    errorCategory: null,
    occurredAt: new Date().toISOString(),
  }
}
