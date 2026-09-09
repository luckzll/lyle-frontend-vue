import { describe, expect, it } from 'vitest'
import { isWechatQrUrl } from '../../src/domain/wechat-login'

describe('WeChat QR URL boundary', () => {
  const url = 'https://open.weixin.qq.com/connect/qrconnect?scope=snsapi_login&self_redirect=false'
  it('accepts only the official top-navigation website login', () => expect(isWechatQrUrl(url)).toBe(true))
  it.each([null, '', 'javascript:alert(1)', url.replace('https:', 'http:'), url.replace('open.weixin.qq.com', 'evil.example'),
    url.replace('/connect/qrconnect', '/other'), url.replace('false', 'true'), url.replace('snsapi_login', 'snsapi_userinfo'),
    url.replace('open.weixin.qq.com', 'user:pass@open.weixin.qq.com')])('rejects %s', (value) => expect(isWechatQrUrl(value)).toBe(false))
})
