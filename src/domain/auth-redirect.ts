const FALLBACK_ROUTE = '/dashboard'

export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value) return FALLBACK_ROUTE

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return FALLBACK_ROUTE
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//')) return FALLBACK_ROUTE
  if (decoded.includes('\\') || decoded.includes('\0') || /[\u0000-\u001f\u007f]/.test(decoded)) return FALLBACK_ROUTE
  if (decoded === '/login' || decoded.startsWith('/login?') || decoded.startsWith('/login#')) return FALLBACK_ROUTE
  return decoded
}

export function resolveAuthRedirect(value: unknown): { target: string; status: 'succeeded' | 'skipped' | 'rejected' } {
  if (typeof value !== 'string' || !value) return { target: FALLBACK_ROUTE, status: 'skipped' }
  const target = safeRedirect(value)
  try {
    const decoded = decodeURIComponent(value)
    return target === FALLBACK_ROUTE && decoded !== FALLBACK_ROUTE
      ? { target, status: 'rejected' }
      : { target, status: 'succeeded' }
  } catch {
    return { target, status: 'rejected' }
  }
}
