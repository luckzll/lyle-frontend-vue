import { createRouter, createWebHistory } from 'vue-router'
import { hasAuth } from '@/auth'
import ChatView from '@/views/ChatView.vue'
import ConversationView from '@/views/ConversationView.vue'
import KnowledgeBaseView from '@/views/KnowledgeBaseView.vue'
import LoginView from '@/views/LoginView.vue'
import MemoryView from '@/views/MemoryView.vue'
import SettingsView from '@/views/SettingsView.vue'
import AdminView from '@/views/AdminView.vue'
import TasksView from '@/views/TasksView.vue'
import EvaluationView from '@/views/EvaluationView.vue'
import PromptView from '@/views/PromptView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'chat', component: ChatView },
    { path: '/knowledge-bases', name: 'knowledge-bases', component: KnowledgeBaseView },
    { path: '/conversations', name: 'conversations', component: ConversationView },
    { path: '/memory', name: 'memory', component: MemoryView },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/evaluation', name: 'evaluation', component: EvaluationView },
    { path: '/prompts', name: 'prompts', component: PromptView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/admin', name: 'admin', component: AdminView }
  ]
})

router.beforeEach((to) => {
  if (to.name !== 'login' && !hasAuth()) {
    return { name: 'login' }
  }
  if (to.name === 'login' && hasAuth()) {
    return { name: 'chat' }
  }
  return true
})

export default router
