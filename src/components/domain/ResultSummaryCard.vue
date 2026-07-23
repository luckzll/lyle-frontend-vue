<script setup lang="ts">
import { computed } from 'vue'
import type { ExecutionResultSummary } from '@/api/types'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import { formatBeijingTime, humanizeIsoDateTimes } from '@/domain/date-time'

const props = withDefaults(defineProps<{
  item: ExecutionResultSummary
  loading?: boolean
  compact?: boolean
  copyState?: 'idle' | 'copied' | 'failed'
}>(), {
  loading: false,
  compact: false,
  copyState: 'idle'
})

defineEmits<{
  action: [item: ExecutionResultSummary, action: { type: string; label: string }]
  viewDetails: [item: ExecutionResultSummary]
  copyLink: [item: ExecutionResultSummary]
  sourceOpen: [item: ExecutionResultSummary, source: 'project' | 'automation']
}>()

const projectId = computed(() => positiveId(props.item.projectId))
const automationId = computed(() => positiveId(props.item.automationId))

function formatTime(value: string) {
  return formatBeijingTime(value, value)
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function isPrimaryAction(type: string) {
  return ['retry', 'retry_automation', 'view_incomplete', 'resume_workflow', 'resume_workflow_second'].includes(type)
}
</script>

<template>
  <AppCard class="result-card" :class="{ compact }" :aria-busy="loading">
    <header>
      <StatusBadge :status="item.status" />
      <time>{{ formatTime(item.createdAt) }}</time>
    </header>
    <div>
      <h2>{{ humanizeIsoDateTimes(item.title) }}</h2>
      <p class="conclusion">{{ humanizeIsoDateTimes(item.conclusion) }}</p>
    </div>

    <nav v-if="projectId || automationId" class="source-links" aria-label="结果来源">
      <span>来源</span>
      <RouterLink
        v-if="projectId"
        :to="`/projects/${projectId}`"
        @click="$emit('sourceOpen', item, 'project')"
      >项目 #{{ projectId }}</RouterLink>
      <RouterLink
        v-if="automationId"
        :to="{ path: '/automations', query: { automationId: String(automationId) } }"
        @click="$emit('sourceOpen', item, 'automation')"
      >自动化 · {{ item.automationName || `#${automationId}` }}</RouterLink>
    </nav>

    <section v-if="!compact && item.completedItems.length">
      <strong>已完成</strong>
      <ul><li v-for="done in item.completedItems" :key="done">{{ done }}</li></ul>
    </section>
    <section v-if="item.risks.length" class="risks">
      <strong>风险或阻塞</strong>
      <ul><li v-for="risk in item.risks" :key="risk">{{ risk }}</li></ul>
    </section>

    <footer>
      <AppButton
        v-for="action in item.recommendedActions"
        :key="action.type"
        :variant="isPrimaryAction(action.type) ? 'primary' : 'secondary'"
        size="sm"
        :loading="loading && isPrimaryAction(action.type)"
        :disabled="loading"
        @click="$emit('action', item, action)"
      >{{ action.label }}</AppButton>
      <AppButton variant="ghost" size="sm" :disabled="loading" @click="$emit('viewDetails', item)">技术详情</AppButton>
      <AppButton variant="ghost" size="sm" :disabled="loading" @click="$emit('copyLink', item)">
        {{ copyState === 'copied' ? '链接已复制' : copyState === 'failed' ? '复制失败' : '复制结果链接' }}
      </AppButton>
    </footer>
  </AppCard>
</template>

<style scoped>
.result-card { display: grid; gap: var(--space-4); }
.result-card.compact { gap: var(--space-3); padding: var(--space-4); }
header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
time { color: var(--muted-foreground); font-size: 12px; }
h2 { margin: 0 0 6px; color: var(--foreground); font-size: 19px; overflow-wrap: anywhere; }
.conclusion { margin: 0; color: var(--foreground); font-size: 15px; line-height: 1.65; }
.source-links { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); color: var(--muted-foreground); font-size: 13px; }
.source-links span { font-weight: 650; }
.source-links a { border-radius: var(--radius-sm); color: var(--primary); font-weight: 650; text-decoration: underline; text-underline-offset: 3px; }
section { border-top: 1px solid var(--border); padding-top: var(--space-3); }
section strong { font-size: 13px; }
ul { margin: var(--space-2) 0 0; padding-left: 20px; color: var(--muted-foreground); }
li + li { margin-top: 4px; }
.risks { border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--warning-soft); padding: var(--space-3); color: var(--warning-strong); }
.risks ul { color: inherit; }
footer { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 420px) { header { align-items: flex-start; flex-direction: column; } footer :deep(button) { width: 100%; } }
</style>
