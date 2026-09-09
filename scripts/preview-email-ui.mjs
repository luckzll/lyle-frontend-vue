// Isolated UI preview, no live backend, no email sending and no valid credentials.
import { createServer } from 'node:http'
let boundPreview = false
let wechatPreview = false
const user = { id: 42, username: 'preview-user', role: 'USER', status: 'ACTIVE', lastLoginAt: '2026-09-08T14:00:00Z' }
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/api/auth/captcha/challenge' || req.url === '/api/auth/captcha/verify') {
    try {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 16384) { res.statusCode = 413; return res.end('{}') }; chunks.push(chunk) }
      const result = await fetch('http://127.0.0.1:4194' + req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(12000) })
      res.statusCode = result.status; return res.end(await result.text())
    } catch { res.statusCode = 503; return res.end('{"detail":"本地滑块预览服务未启动。"}') }
  }
  if (req.url === '/api/preview/bound') { boundPreview = true; return res.end('{"preview":"bound email, synthetic data only"}') }
  if (req.url === '/api/preview/anonymous') { boundPreview = false; return res.end('{}') }
  if (req.url === '/api/preview/wechat-link') { wechatPreview = true; return res.end('{}') }
  if (req.url === '/api/preview/wechat-disabled') { wechatPreview = false; return res.end('{}') }
  if (boundPreview && req.url === '/api/auth/refresh') {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    return res.end(JSON.stringify({ user, accessToken: 'preview.' + payload + '.not-a-real-signature', expiresInSeconds: 3600 }))
  }
  if (boundPreview && req.url === '/api/auth/email/binding') return res.end('{"email":"preview@example.com"}')
  if (boundPreview && req.url === '/api/users/me') return res.end(JSON.stringify(user))
  if (boundPreview && req.url === '/api/auth/session') return res.end(JSON.stringify({ createdAt: user.lastLoginAt, lastUsedAt: user.lastLoginAt, current: true }))
  if (req.url === '/api/auth/email/options') return res.end(JSON.stringify({ enabled: true, captcha: { provider: 'tianai', configured: true } }))
  if (req.url === '/api/runtime-config') return res.end('{}')
  if (req.url === '/api/auth/wechat/options') return res.end(JSON.stringify({ enabled: wechatPreview }))
  if (wechatPreview && req.url === '/api/auth/wechat/complete') return res.end('{"requiresEmail":true}')
  if (req.url === '/api/auth/wechat/cancel') return res.end('{"cancelled":true}')
  if (req.url === '/api/auth/refresh') { res.statusCode = 401; return res.end('{}') }
  res.statusCode = 503; res.end(JSON.stringify({ detail: '本地设计预览不连接真实服务。' }))
}).listen(4193, '127.0.0.1', () => console.log('Isolated email UI API: 127.0.0.1:4193'))
