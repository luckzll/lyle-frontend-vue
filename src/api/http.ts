import axios from 'axios'
import { clearAuth, getAuthToken } from '@/auth'

export const http = axios.create({
  baseURL: '/api',
  timeout: 60000
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
  (error) => {
    const status = error?.response?.status
    if ((status === 401 || status === 403) && window.location.pathname !== '/login') {
      clearAuth()
      window.location.assign('/login')
    }
    return Promise.reject(error)
  }
)
