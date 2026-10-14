import { describe, expect, it } from 'vitest'
import { attachmentRequestError } from '../../src/domain/attachment-error'

describe('attachment errors', () => {
  it('explains a proxy 413 without displaying its HTML page', () => {
    const text = attachmentRequestError({ response: { status: 413, data: '<html><body>413 Request Entity Too Large</body></html>' } })
    expect(text).toContain('服务器'); expect(text).toContain('5MB'); expect(text).not.toContain('<html>')
  })
  it('handles gateway HTML, expiration and safe application messages', () => {
    expect(attachmentRequestError({ response: { status: 502, data: '<html>Bad Gateway</html>' } })).toContain('暂时不可用')
    expect(attachmentRequestError({ response: { status: 401 } })).toContain('重新登录')
    expect(attachmentRequestError({ response: { status: 400, data: { message: '文件格式无效' } } })).toBe('文件格式无效')
    expect(attachmentRequestError({ response: { status: 400, data: '<html>private error</html>' } })).toBe('附件上传失败，请重试。')
  })
})
