// Only the fixed official provider is allowed in the cross-origin QR frame.
export function isWechatQrUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.origin === 'https://open.weixin.qq.com' && url.pathname === '/connect/qrconnect'
      && !url.username && !url.password && url.searchParams.get('scope') === 'snsapi_login'
      && url.searchParams.get('self_redirect') === 'false'
  } catch { return false }
}
