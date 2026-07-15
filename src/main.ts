import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './design/tokens.css'
import './design/semantic.css'
import './styles.css'
import { applyUserPreferences } from './domain/user-preferences'

applyUserPreferences()
createApp(App).use(createPinia()).use(router).mount('#app')
