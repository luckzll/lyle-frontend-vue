// Provider-neutral ASCII email validation, shared by login and account binding.
export function normalizeEmail(value: string): string { return value.trim().toLowerCase() }
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value)
  const parts = email.split('@')
  if (email.length > 254 || parts.length !== 2 || parts[0].length > 64) return false
  if (parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)
    && parts[1].split('.').every(label => label.length <= 63)
}
export function maskEmail(value: string): string {
  const [local, domain] = value.split('@')
  return domain ? `${local.slice(0, Math.min(2, local.length))}***@${domain}` : value
}
