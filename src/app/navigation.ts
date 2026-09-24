import type { Component } from 'vue'
import { isAgentTaskFrontendEnabled } from '@/features/agentTask'
import { isMissionFrontendEnabled } from '@/features/mission'
import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from 'vue-router'
import {
  Activity,
  Bot,
  Brain,
  CalendarSync,
  ClipboardCheck,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LibraryBig,
  ListTodo,
  MessageSquare,
  Inbox,
  PlugZap,
  ShieldCheck,
  SlidersHorizontal,
  Workflow
} from '@lucide/vue'

export type NavigationGroupId = 'start' | 'knowledge' | 'progress' | 'system' | 'admin'
export type NavigationBadgeSource = 'reminders' | 'execution'

export interface NavigationMatch {
  routeNames: string[]
  query?: Record<string, string>
  excludeQuery?: Record<string, string>
}

export interface NavigationItem {
  id: string
  label: string
  description: string
  to: RouteLocationRaw
  icon: Component
  match: NavigationMatch
  requiresAdmin?: boolean
  badgeSource?: NavigationBadgeSource
}

export interface NavigationGroup {
  id: NavigationGroupId
  label: string
  items: NavigationItem[]
}

export const navigationGroups: NavigationGroup[] = [
  {
    id: 'start',
    label: '开始',
    items: [
      {
        id: 'dashboard',
        label: '工作台',
        description: '查看今日重点和待处理事项',
        to: '/dashboard',
        icon: LayoutDashboard,
        match: { routeNames: ['dashboard'] }
      },
      {
        id: 'tasks',
        label: '任务',
        description: '处理待办与日程，推进项目计划',
        to: '/tasks',
        icon: ListTodo,
        match: { routeNames: ['tasks', 'projects', 'project-detail'] },
        badgeSource: 'reminders'
      },
      {
        id: 'automations',
        label: '自动化',
        description: '创建和管理自动运行',
        to: '/automations',
        icon: Workflow,
        match: { routeNames: ['automations'] }
      },
      {
        id: 'agent-tasks',
        label: 'Agent Task',
        description: '创建和控制多步任务',
        to: '/agent-tasks',
        icon: Bot,
        match: { routeNames: ['agent-tasks', 'agent-task-create', 'agent-plan-approval', 'agent-task-detail'] }
      },
      {
        id: 'missions',
        label: '持续任务',
        description: '管理可信委托和周期运行',
        to: '/missions',
        icon: CalendarSync,
        match: { routeNames: ['missions', 'mission-create', 'mission-detail', 'mission-grant', 'mission-shadow'] }
      },
      {
        id: 'exceptions',
        label: '异常收件箱',
        description: '处理越界、冲突和失败',
        to: '/exceptions',
        icon: Inbox,
        match: { routeNames: ['exceptions', 'exception-detail'] }
      },
      {
        id: 'execution-center',
        label: '执行中心',
        description: '处理确认、异常和结果',
        to: '/execution-center',
        icon: Activity,
        match: { routeNames: ['execution-center'] },
        badgeSource: 'execution'
      }
    ]
  },
  {
    id: 'progress',
    label: '推进',
    items: [
      {
        id: 'chat',
        label: '聊天',
        description: '与 Lyle AI 对话',
        to: '/',
        icon: MessageSquare,
        match: { routeNames: ['chat', 'conversations'] }
      },
      {
        id: 'projects',
        label: '项目',
        description: '连接本机目录，围绕项目继续对话',
        to: '/local-project',
        icon: FolderKanban,
        match: { routeNames: ['local-project'] }
      }
    ]
  },
  {
    id: 'knowledge',
    label: '资料',
    items: [
      {
        id: 'knowledge-bases',
        label: '知识库',
        description: '管理可检索的资料',
        to: '/knowledge-bases',
        icon: LibraryBig,
        match: { routeNames: ['knowledge-bases'] }
      },
      {
        id: 'memory',
        label: '记忆',
        description: '管理长期记忆',
        to: '/memory',
        icon: Brain,
        match: { routeNames: ['memory'] }
      }
    ]
  },
  {
    id: 'system',
    label: '系统',
    items: [
      {
        id: 'connections',
        label: '连接',
        description: '检查外部服务连接',
        to: '/connections',
        icon: PlugZap,
        match: { routeNames: ['connections'] }
      },
      {
        id: 'advanced-settings',
        label: '高级设置',
        description: '打开高级工作台',
        to: '/advanced-settings',
        icon: SlidersHorizontal,
        match: { routeNames: ['advanced-settings'] }
      }
    ]
  },
  {
    id: 'admin',
    label: '管理员',
    items: [
      {
        id: 'evaluation',
        label: '评测',
        description: '运行和查看质量评测',
        to: '/evaluation',
        icon: ClipboardCheck,
        match: { routeNames: ['evaluation'] },
        requiresAdmin: true
      },
      {
        id: 'prompts',
        label: 'Prompt',
        description: '管理 Prompt',
        to: '/prompts',
        icon: FileText,
        match: { routeNames: ['prompts'] },
        requiresAdmin: true
      },
      {
        id: 'admin',
        label: '管理',
        description: '打开管理员控制台',
        to: '/admin',
        icon: ShieldCheck,
        match: { routeNames: ['admin'] },
        requiresAdmin: true
      }
    ]
  }
]

export type TaskAreaMode = 'todos' | 'projects'

/** Existing project management deep links belong to the task area. */
export function getTaskAreaMode(route: RouteLocationNormalizedLoaded): TaskAreaMode | null {
  if (route.name === 'tasks') return 'todos'
  if (route.name === 'projects' || route.name === 'project-detail') return 'projects'
  return null
}

export function getVisibleNavigationGroups(isAdmin: boolean, userId?: string | number | null): NavigationGroup[] {
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        (!item.requiresAdmin || isAdmin)
        && (item.id !== 'agent-tasks' || isAgentTaskFrontendEnabled(userId))
        && (!['missions', 'exceptions'].includes(item.id) || isMissionFrontendEnabled(userId))
      )
    }))
    .filter((group) => group.items.length > 0)
}

export function isNavigationItemActive(
  item: NavigationItem,
  route: RouteLocationNormalizedLoaded
): boolean {
  const routeName = typeof route.name === 'string' ? route.name : ''
  if (!item.match.routeNames.includes(routeName)) return false

  if (item.match.query) {
    const matchesQuery = Object.entries(item.match.query).every(
      ([key, value]) => route.query[key] === value
    )
    if (!matchesQuery) return false
  }

  if (item.match.excludeQuery) {
    const matchesExcludedQuery = Object.entries(item.match.excludeQuery).every(
      ([key, value]) => route.query[key] === value
    )
    if (matchesExcludedQuery) return false
  }

  return true
}

export function getNavigationBadge(
  item: NavigationItem,
  badgeCounts: Partial<Record<NavigationBadgeSource, number>>
): number {
  if (!item.badgeSource) return 0
  return Math.max(0, badgeCounts[item.badgeSource] ?? 0)
}

export function getNavigationBadgeLabel(item: NavigationItem, count: number): string {
  if (item.badgeSource === 'execution') return `${count} 项需处理`
  return `${count} 条未读提醒`
}
