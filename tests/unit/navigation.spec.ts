import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import {
  getNavigationBadge,
  getNavigationBadgeLabel,
  getVisibleNavigationGroups,
  isNavigationItemActive,
  navigationGroups
} from '@/app/navigation'

function route(
  name: string,
  query: Record<string, string> = {}
): RouteLocationNormalizedLoaded {
  return { name, query } as unknown as RouteLocationNormalizedLoaded
}

describe('application navigation', () => {
  it('keeps the product-defined group order', () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      '开始',
      '推进',
      '资料',
      '系统',
      '管理员'
    ])
    expect(Object.fromEntries(
      navigationGroups.map((group) => [group.label, group.items.map((item) => item.label)])
    )).toEqual({
      开始: ['工作台', '聊天'],
      推进: ['项目', '任务', '自动化', 'Agent Task', '持续任务', '异常收件箱', '执行中心'],
      资料: ['知识库', '记忆', '会话'],
      系统: ['连接', '高级设置'],
      管理员: ['评测', 'Prompt', '管理']
    })
  })

  it('hides administrator navigation from regular users', () => {
    const groups = getVisibleNavigationGroups(false)

    expect(groups.map((group) => group.label)).toEqual(['开始', '推进', '资料', '系统'])
    expect(groups.flatMap((group) => group.items).some((item) => item.requiresAdmin)).toBe(false)
  })

  it('shows administrator navigation to administrators', () => {
    const groups = getVisibleNavigationGroups(true)
    const adminGroup = groups.find((group) => group.id === 'admin')

    expect(adminGroup?.label).toBe('管理员')
    expect(adminGroup?.items.map((item) => item.label)).toEqual(['评测', 'Prompt', '管理'])
  })

  it('keeps the execution center active for the history query', () => {
    const executionCenter = navigationGroups
      .flatMap((group) => group.items)
      .find((item) => item.id === 'execution-center')

    expect(executionCenter).toBeDefined()
    expect(isNavigationItemActive(executionCenter!, route('execution-center', { view: 'history' }))).toBe(true)
    expect(isNavigationItemActive(executionCenter!, route('settings', { view: 'history' }))).toBe(false)
  })

  it('does not expose operations as a primary navigation item', () => {
    const items = navigationGroups.flatMap((group) => group.items)

    expect(items.map((item) => item.id)).not.toContain('operations')
    expect(items.map((item) => item.label)).not.toContain('操作')
    expect(items.map((item) => item.to)).not.toContain('/operations')
  })

  it('keeps task reminders and execution attention on independent badges', () => {
    const items = navigationGroups.flatMap((group) => group.items)
    const tasks = items.find((item) => item.id === 'tasks')!
    const executionCenter = items.find((item) => item.id === 'execution-center')!
    const counts = { reminders: 2, execution: 5 }

    expect(getNavigationBadge(tasks, counts)).toBe(2)
    expect(getNavigationBadgeLabel(tasks, 2)).toBe('2 条未读提醒')
    expect(getNavigationBadge(executionCenter, counts)).toBe(5)
    expect(getNavigationBadgeLabel(executionCenter, 5)).toBe('5 项执行待处理')
  })
})
