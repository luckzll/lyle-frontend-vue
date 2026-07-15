export type InterfaceDensity = 'comfortable' | 'compact'

export interface UserPreferences {
  density: InterfaceDensity
  reduceMotion: boolean
}

const STORAGE_KEY = 'lyle-user-preferences'

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  density: 'comfortable',
  reduceMotion: false
}

export function loadUserPreferences(): UserPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_USER_PREFERENCES }
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<UserPreferences>
    return {
      density: stored.density === 'compact' ? 'compact' : 'comfortable',
      reduceMotion: Boolean(stored.reduceMotion)
    }
  } catch {
    return { ...DEFAULT_USER_PREFERENCES }
  }
}

export function saveUserPreferences(preferences: UserPreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  applyUserPreferences(preferences)
}

export function applyUserPreferences(preferences = loadUserPreferences()) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.density = preferences.density
  document.documentElement.classList.toggle('reduce-motion', preferences.reduceMotion)
}
