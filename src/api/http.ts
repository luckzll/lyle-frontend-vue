import axios from 'axios'
import { clearAuth, getAuthToken, refreshAuth } from '@/auth'

export const http = axios.create({
  baseURL: '/api',
  timeout: 60000,
  withCredentials: true
})

// Public bootstrap requests must never clear an existing authenticated session.
// They also use a short timeout so optional runtime configuration cannot delay UI.
export const publicHttp = axios.create({
  baseURL: '/api',
  timeout: 3000
})

http.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status
    const config = error?.config as (typeof error.config & { _authRetry?: boolean }) | undefined
    const isAuthEndpoint = typeof config?.url === 'string' && config.url.startsWith('/auth/')
    if (status === 401 && config && !config._authRetry && !isAuthEndpoint) {
      config._authRetry = true
      if (await refreshAuth()) {
        const token = getAuthToken()
        if (token) config.headers.Authorization = `Bearer ${token}`
        return http.request(config)
      }
    }
    if (status === 401 && window.location.pathname !== '/login' && !isAuthEndpoint) {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
      clearAuth()
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`)
    }
    return Promise.reject(error)
  }
)
