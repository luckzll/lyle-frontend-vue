import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser, hasAuth, initializeAuth } from '@/auth'
import { isAgentTaskFrontendEnabled } from '@/features/agentTask'
import { isMissionFrontendEnabled } from '@/features/mission'
import type { NavigationGroupId } from '@/app/navigation'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
    navGroup?: NavigationGroupId
    icon?: string
    requiresAuth: boolean
    requiresAdmin: boolean
    layout: 'auth' | 'default'
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: {
        title: '登录',
        icon: 'log-in',
        requiresAuth: false,
        requiresAdmin: false,
        layout: 'auth'
      }
    },
    {
      path: '/',
      name: 'chat',
      component: () => import('@/views/ChatView.vue'),
      meta: {
        title: '聊天',
        navGroup: 'start',
        icon: 'message-square',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: {
        title: '工作台',
        navGroup: 'start',
        icon: 'layout-dashboard',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/knowledge-bases',
      name: 'knowledge-bases',
      component: () => import('@/views/KnowledgeBaseView.vue'),
      meta: {
        title: '知识库',
        navGroup: 'knowledge',
        icon: 'library-big',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/knowledge',
      name: 'knowledge-legacy',
      redirect: (to) => ({ path: '/knowledge-bases', query: to.query, hash: to.hash }),
      meta: {
        title: '知识库',
        navGroup: 'knowledge',
        icon: 'library-big',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/conversations',
      name: 'conversations',
      component: () => import('@/views/ConversationView.vue'),
      meta: {
        title: '会话',
        navGroup: 'knowledge',
        icon: 'messages-square',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/connectors',
      name: 'connectors',
      redirect: (to) => ({
        path: '/advanced-settings',
        query: { ...to.query, tab: 'connectors' }
      }),
      meta: {
        title: '连接器',
        navGroup: 'system',
        icon: 'plug',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/advanced-settings',
      name: 'advanced-settings',
      component: () => import('@/views/WorkbenchView.vue'),
      meta: {
        title: '高级设置',
        navGroup: 'system',
        icon: 'sliders-horizontal',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/automations',
      name: 'automations',
      component: () => import('@/views/AutomationHomeView.vue'),
      meta: {
        title: '自动化',
        navGroup: 'progress',
        icon: 'workflow',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/agent-tasks',
      name: 'agent-tasks',
      component: () => import('@/views/AgentTasksView.vue'),
      meta: {
        title: 'Agent Task',
        navGroup: 'progress',
        icon: 'bot',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/agent-tasks/new',
      name: 'agent-task-create',
      component: () => import('@/views/AgentTaskCreateView.vue'),
      meta: {
        title: '新建 Agent Task',
        navGroup: 'progress',
        icon: 'bot',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/agent-tasks/:id/plan',
      name: 'agent-plan-approval',
      component: () => import('@/views/AgentPlanApprovalView.vue'),
      meta: {
        title: '审批执行计划',
        navGroup: 'progress',
        icon: 'list-checks',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/agent-tasks/:id',
      name: 'agent-task-detail',
      component: () => import('@/views/AgentTaskDetailView.vue'),
      meta: {
        title: 'Agent Task 运行台',
        navGroup: 'progress',
        icon: 'bot',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/missions',
      name: 'missions',
      component: () => import('@/views/MissionsView.vue'),
      meta: {
        title: '持续任务',
        navGroup: 'progress',
        icon: 'calendar-sync',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/missions/new',
      name: 'mission-create',
      component: () => import('@/views/MissionCreateView.vue'),
      meta: {
        title: '新建持续任务',
        navGroup: 'progress',
        icon: 'calendar-plus',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/missions/:id/grant',
      name: 'mission-grant',
      component: () => import('@/views/MissionGrantView.vue'),
      meta: {
        title: '委托授权',
        navGroup: 'progress',
        icon: 'shield-check',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/missions/:id/shadow',
      name: 'mission-shadow',
      component: () => import('@/views/MissionShadowView.vue'),
      meta: {
        title: 'Shadow Mode',
        navGroup: 'progress',
        icon: 'eye',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/missions/:id',
      name: 'mission-detail',
      component: () => import('@/views/MissionDetailView.vue'),
      meta: {
        title: '持续任务详情',
        navGroup: 'progress',
        icon: 'calendar-sync',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/exceptions',
      name: 'exceptions',
      component: () => import('@/views/ExceptionsView.vue'),
      meta: {
        title: '异常收件箱',
        navGroup: 'progress',
        icon: 'inbox',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/exceptions/:id',
      name: 'exception-detail',
      component: () => import('@/views/ExceptionDetailView.vue'),
      meta: {
        title: '异常详情',
        navGroup: 'progress',
        icon: 'triangle-alert',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/execution-center',
      name: 'execution-center',
      component: () => import('@/views/ExecutionCenterView.vue'),
      meta: {
        title: '执行中心',
        navGroup: 'progress',
        icon: 'activity',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/connections',
      name: 'connections',
      component: () => import('@/views/ConnectionView.vue'),
      meta: {
        title: '连接',
        navGroup: 'system',
        icon: 'plug-zap',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/memory',
      name: 'memory',
      component: () => import('@/views/MemoryView.vue'),
      meta: {
        title: '记忆',
        navGroup: 'knowledge',
        icon: 'brain',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/views/TasksView.vue'),
      meta: {
        title: '任务',
        navGroup: 'progress',
        icon: 'list-todo',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectView.vue'),
      meta: {
        title: '项目',
        navGroup: 'progress',
        icon: 'folder-kanban',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/projects/:projectId',
      name: 'project-detail',
      component: () => import('@/views/ProjectView.vue'),
      meta: {
        title: '项目详情',
        navGroup: 'progress',
        icon: 'folder-kanban',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/operations',
      name: 'operations',
      redirect: (to) => ({
        path: '/execution-center',
        query: { ...to.query, view: 'history' }
      }),
      meta: {
        title: '操作',
        navGroup: 'system',
        icon: 'history',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/evaluation',
      name: 'evaluation',
      component: () => import('@/views/EvaluationView.vue'),
      meta: {
        title: '评测',
        navGroup: 'admin',
        icon: 'clipboard-check',
        requiresAuth: true,
        requiresAdmin: true,
        layout: 'default'
      }
    },
    {
      path: '/prompts',
      name: 'prompts',
      component: () => import('@/views/PromptView.vue'),
      meta: {
        title: 'Prompt',
        navGroup: 'admin',
        icon: 'file-text',
        requiresAuth: true,
        requiresAdmin: true,
        layout: 'default'
      }
    },
    {
      path: '/pricing',
      name: 'pricing',
      component: () => import('@/views/PricingView.vue'),
      meta: {
        title: '套餐与定价',
        navGroup: 'system',
        icon: 'credit-card',
        requiresAuth: false,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/checkout/:orderNo',
      name: 'checkout',
      component: () => import('@/views/CheckoutView.vue'),
      meta: {
        title: '收银台',
        navGroup: 'system',
        icon: 'credit-card',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/billing/result/:orderNo',
      name: 'billing-result',
      component: () => import('@/views/BillingResultView.vue'),
      meta: {
        title: '支付结果',
        navGroup: 'system',
        icon: 'badge-check',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: {
        title: '设置',
        navGroup: 'system',
        icon: 'settings',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/settings/usage',
      name: 'usage',
      component: () => import('@/views/UsageView.vue'),
      meta: {
        title: '设置',
        navGroup: 'system',
        icon: 'bar-chart-3',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/settings/billing',
      name: 'billing',
      component: () => import('@/views/BillingView.vue'),
      meta: {
        title: '套餐与账单',
        navGroup: 'system',
        icon: 'wallet-cards',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/settings/billing/orders/:orderNo',
      name: 'billing-order',
      component: () => import('@/views/BillingOrderDetailView.vue'),
      meta: {
        title: '订单详情',
        navGroup: 'system',
        icon: 'receipt-text',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: {
        title: '管理',
        navGroup: 'admin',
        icon: 'shield-check',
        requiresAuth: true,
        requiresAdmin: true,
        layout: 'default'
      }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: {
        title: '页面未找到',
        requiresAuth: true,
        requiresAdmin: false,
        layout: 'default'
      }
    }
  ]
})

router.beforeEach(async (to) => {
  await initializeAuth()
  if (to.meta.requiresAuth && !hasAuth()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.path.startsWith('/agent-tasks') && !isAgentTaskFrontendEnabled(getCurrentUser()?.id)) {
    return { path: '/execution-center', query: { feature: 'agent-task-unavailable' } }
  }
  if ((to.path.startsWith('/missions') || to.path.startsWith('/exceptions'))
      && !isMissionFrontendEnabled(getCurrentUser()?.id)) {
    return { path: '/execution-center', query: { feature: 'mission-unavailable' } }
  }
  if (to.name === 'login' && hasAuth()) {
    return { name: 'dashboard' }
  }
  if (to.meta.requiresAdmin && getCurrentUser()?.role !== 'ADMIN') {
    return { name: 'dashboard' }
  }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Lyle AI` : 'Lyle AI'
})

export default router
