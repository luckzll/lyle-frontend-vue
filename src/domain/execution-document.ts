import type { ExecutionResultSummary } from '@/api/types'

/** Export the visible result, preserving failure and data-scope information. */
export function executionDocument(result: ExecutionResultSummary) {
  const section = (title: string, items: string[]) => items.length ? `\n\n## ${title}\n\n${items.map(item => `- ${item}`).join('\n')}` : ''
  const states = { completed: '已完成', partial: '部分完成', failed: '失败', awaiting_confirmation: '等待确认' }
  return `# ${result.title}\n\n状态：${states[result.status]}\n\n${result.conclusion}`
    + section('已完成', result.completedItems) + section('风险或阻塞', result.risks)
    + section('建议下一步', result.recommendedActions.map(item => item.label))
    + `\n\n## 数据范围\n\n${result.dataScope.length ? result.dataScope.join('、') : '未返回数据范围'}`
    + `\n\n生成时间：${result.createdAt}`
}
