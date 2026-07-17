const runtimeEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
const testMode = runtimeEnv.MODE === 'test'
const enabled = testMode || String(runtimeEnv.VITE_MISSION_ENABLED || '').toLowerCase() === 'true'
const enabledUsers = new Set(
  String(testMode ? '*' : (runtimeEnv.VITE_MISSION_ENABLED_USERS || ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)

export function isMissionFrontendEnabledForConfig(
  featureEnabled: boolean,
  allowedUsers: ReadonlySet<string>,
  userId?: string | number | null
) {
  if (!featureEnabled || userId == null) return false
  return allowedUsers.has('*') || allowedUsers.has(String(userId))
}

export function isMissionFrontendEnabled(userId?: string | number | null) {
  return isMissionFrontendEnabledForConfig(enabled, enabledUsers, userId)
}
