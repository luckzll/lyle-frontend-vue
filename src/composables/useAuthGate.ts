import { reactive, readonly } from 'vue'

interface AuthGateState {
  open: boolean
  target: string
  actionLabel: string
}

const state = reactive<AuthGateState>({
  open: false,
  target: '/',
  actionLabel: '继续使用 Lyle'
})

export const authGateState = readonly(state)

export function requestAuth(target = '/', actionLabel = '继续使用 Lyle') {
  state.target = target
  state.actionLabel = actionLabel
  state.open = true
}

export function closeAuthGate() {
  state.open = false
}
