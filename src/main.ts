import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './design/tokens.css'
import './design/semantic.css'
import './styles.css'
import { applyUserPreferences } from './domain/user-preferences'
import { loadRuntimeFeatures } from './composables/useRuntimeFeatures'

function bootstrap() {
  applyUserPreferences()
  const app = createApp(App).use(createPinia()).use(router)
  // Runtime rollback flags are optional enhancement data. Start the request in
  // parallel and apply the server response reactively without awaiting it.
  void loadRuntimeFeatures()
  // Wait only for local route resolution so a protected deep link never
  // renders the dashboard briefly and starts unrelated authenticated calls.
  void router.isReady().then(() => app.mount('#app'))
}

bootstrap()
