import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser, hasAuth } from '@/auth'
import ChatView from '@/views/ChatView.vue'
import ConversationView from '@/views/ConversationView.vue'
import DashboardView from '@/views/DashboardView.vue'
import KnowledgeBaseView from '@/views/KnowledgeBaseView.vue'
import LoginView from '@/views/LoginView.vue'
import MemoryView from '@/views/MemoryView.vue'
import SettingsView from '@/views/SettingsView.vue'
import AdminView from '@/views/AdminView.vue'
import TasksView from '@/views/TasksView.vue'
import EvaluationView from '@/views/EvaluationView.vue'
import PromptView from '@/views/PromptView.vue'
import OperationsView from '@/views/OperationsView.vue'
import ProjectView from '@/views/ProjectView.vue'
import WorkbenchView from '@/views/WorkbenchView.vue'
import AutomationHomeView from '@/views/AutomationHomeView.vue'
import ExecutionCenterView from '@/views/ExecutionCenterView.vue'
import ConnectionView from '@/views/ConnectionView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'chat', component: ChatView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/knowledge-bases', name: 'knowledge-bases', component: KnowledgeBaseView },
    { path: '/conversations', name: 'conversations', component: ConversationView },
    { path: '/connectors', redirect: { path: '/advanced-settings', query: { tab: 'connectors' } } },
    { path: '/advanced-settings', name: 'advanced-settings', component: WorkbenchView },
    { path: '/automations', name: 'automations', component: AutomationHomeView },
    { path: '/execution-center', name: 'execution-center', component: ExecutionCenterView },
    { path: '/connections', name: 'connections', component: ConnectionView },
    { path: '/memory', name: 'memory', component: MemoryView },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/projects', name: 'projects', component: ProjectView },
    { path: '/projects/:projectId', name: 'project-detail', component: ProjectView },
    { path: '/operations', name: 'operations', component: OperationsView },
    { path: '/evaluation', name: 'evaluation', component: EvaluationView, meta: { requiresAdmin: true } },
    { path: '/prompts', name: 'prompts', component: PromptView, meta: { requiresAdmin: true } },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/admin', name: 'admin', component: AdminView, meta: { requiresAdmin: true } }
  ]
})

router.beforeEach((to) => {
  if (to.name !== 'login' && !hasAuth()) {
    return { name: 'login' }
  }
  if (to.name === 'login' && hasAuth()) {
    return { name: 'chat' }
  }
  if (to.meta.requiresAdmin && getCurrentUser()?.role !== 'ADMIN') {
    return { name: 'chat' }
  }
  return true
})

export default router
