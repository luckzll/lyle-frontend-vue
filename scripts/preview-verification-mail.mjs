// Local-only visual preview. Never sends mail or creates an authentication code.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
const template = new URL('../../backend-java/src/main/resources/mail/verification-code.html', import.meta.url)
createServer(async (req, res) => {
  if (!['/', '/binding'].includes(req.url)) { res.writeHead(404); return res.end() }
  try {
    const binding = req.url === '/binding'
    const html = (await readFile(template, 'utf8'))
      .replaceAll('{{code}}', '123456')
      .replaceAll('{{action}}', binding ? '绑定邮箱' : '登录')
      .replaceAll('{{title}}', binding ? '验证你的邮箱' : '欢迎回来')
      .replaceAll('{{description}}', binding ? '请在绑定邮箱页面输入下方验证码，完成邮箱绑定。' : '请在登录页面输入下方验证码，继续你的 AI 工作之旅。')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html)
  } catch { res.writeHead(500); res.end('Preview template unavailable') }
}).listen(4195, '127.0.0.1', () => console.log('Email preview only: http://127.0.0.1:4195 (sample code 123456)'))
