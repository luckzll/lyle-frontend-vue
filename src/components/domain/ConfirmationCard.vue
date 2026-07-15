<script setup lang="ts">
import type { ConfirmationInboxItem } from '@/api/types'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import { formatBeijingTime, humanizeIsoDateTimes } from '@/domain/date-time'

type ConfirmationDisplayItem = ConfirmationInboxItem & {
  duplicateCount?: number
  duplicateItems?: ConfirmationInboxItem[]
}

defineProps<{
  item: ConfirmationDisplayItem
  loading?: boolean
}>()

defineEmits<{
  confirm: [item: ConfirmationDisplayItem]
  reject: [item: ConfirmationDisplayItem]
  viewDetails: [item: ConfirmationDisplayItem]
}>()

function formatTime(value?: string | null) {
  return value ? formatBeijingTime(value) : ''
}

function riskLabel(value: string) {
  if (value === 'high' || value === 'high_risk') return '高风险'
  if (value === 'write') return '写操作'
  if (value === 'read') return '只读'
  return value || '未分级'
}

function sourceLabel(value: string) {
  const source = value.toLowerCase()
  if (source.includes('chat') || source.includes('conversation') || source.includes('会话')) return '来自聊天'
  if (source.includes('automation') || source.includes('自动化')) return '来自自动化'
  if (source.includes('project') || source.includes('项目')) return '来自项目'
  return '来自工作流'
}

function impactText(item: ConfirmationDisplayItem) {
  if (item.operationType === 'todo.create') return '将在任务列表创建 1 条待办'
  if (item.operationType === 'calendar.create') return '将在日历中创建 1 条日程'
  if (item.operationType === 'project.update') return '将更新 1 个项目的信息'
  if (item.impactResources.length === 1 && item.impactResources[0] === '已授权范围') return '将仅在当前已授权范围内执行'
  if (item.impactResources.length) return `将影响：${item.impactResources.join('、')}`
  return '具体影响将在执行前再次确认'
}
</script>

<template>
  <AppCard class="confirmation-card" :aria-busy="loading">
    <header>
      <div class="status-line">
        <StatusBadge status="awaiting_confirmation" />
        <span class="risk" :class="{ high: item.requiresSecondConfirmation || !item.reversible }">
          {{ riskLabel(item.riskLevel) }}
        </span>
      </div>
      <h2>{{ humanizeIsoDateTimes(item.actionTitle) }}</h2>
      <p class="source">{{ sourceLabel(item.source) }}<template v-if="item.createdAt"> · {{ formatTime(item.createdAt) }}</template></p>
      <p v-if="(item.duplicateCount || 1) > 1" class="duplicate-count">{{ item.duplicateCount }} 个重复请求已合并</p>
    </header>

    <p class="reason">{{ item.reason }}</p>
    <div class="impact">
      <strong>影响范围</strong>
      <span>{{ impactText(item) }}</span>
    </div>
    <p v-if="!item.reversible" class="warning">此操作可能无法撤销，确认前会再次提示。</p>
    <p v-else class="reversible">可撤销操作</p>

    <footer>
      <AppButton :loading="loading" :disabled="loading" @click="$emit('confirm', item)">确认执行</AppButton>
      <AppButton variant="secondary" :disabled="loading" @click="$emit('reject', item)">拒绝</AppButton>
      <AppButton variant="ghost" :disabled="loading" @click="$emit('viewDetails', item)">查看详情</AppButton>
    </footer>
  </AppCard>
</template>

<style scoped>
.confirmation-card { display: grid; gap: var(--space-4); }
.status-line { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.risk { border-radius: 999px; background: var(--warning-soft); color: var(--warning-strong); padding: 4px 8px; font-size: 12px; font-weight: 750; }
.risk.high { background: var(--danger-soft); color: var(--danger-strong); }
h2 { margin: var(--space-3) 0 4px; color: var(--foreground); font-size: 19px; overflow-wrap: anywhere; }
.source { margin: 0; color: var(--muted-foreground); font-size: 12px; }
.duplicate-count { width: fit-content; margin: var(--space-2) 0 0; border-radius: 999px; background: var(--info-soft); color: var(--info-strong); padding: 4px 8px; font-size: 12px; font-weight: 700; }
.reason { margin: 0; color: var(--foreground); line-height: 1.65; }
.impact { display: grid; gap: 5px; border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-3); }
.impact strong { font-size: 13px; }.impact span { overflow-wrap: anywhere; }
.warning, .reversible { margin: 0; font-size: 13px; font-weight: 650; }
.warning { color: var(--danger-strong); }.reversible { color: var(--success-strong); }
footer { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 420px) { footer :deep(button) { width: 100%; } }
</style>
