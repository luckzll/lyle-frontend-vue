<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Clock3 } from '@lucide/vue'
import type { AgentTask } from '@/api/agentTasks'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'

const props = defineProps<{ task: AgentTask }>()
const progress = computed(() => {
  const total = props.task.plan?.steps.length || 0
  const completed = props.task.run?.budgetUsed.completedSteps || 0
  return total ? Math.min(100, Math.round(completed / total * 100)) : 0
})
const needsAttention = computed(() => ['AWAITING_PLAN_APPROVAL', 'AWAITING_CONFIRMATION', 'AWAITING_INPUT'].includes(props.task.status))
</script>

<template>
  <RouterLink class="task-link" :to="task.status === 'AWAITING_PLAN_APPROVAL' ? `/agent-tasks/${task.id}/plan` : `/agent-tasks/${task.id}`">
    <AppCard class="task-card" interactive>
      <header><div><span class="kind">Agent Task</span><h3>{{ task.title }}</h3></div><StatusBadge :status="task.status" /></header>
      <p>{{ task.goal }}</p>
      <div v-if="task.plan" class="progress"><span :style="{ width: `${progress}%` }" /></div>
      <footer>
        <span v-if="needsAttention" class="attention"><Clock3 :size="14" />需要你处理</span>
        <span v-else>计划 {{ task.plan?.steps.length || 0 }} 步 · 已完成 {{ task.run?.budgetUsed.completedSteps || 0 }} 步</span>
        <ArrowRight :size="16" aria-hidden="true" />
      </footer>
    </AppCard>
  </RouterLink>
</template>

<style scoped>
.task-link { color: inherit; text-decoration: none; }
.task-card { display: grid; height: 100%; gap: var(--space-3); }
header, footer { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.kind { color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
h3 { margin: 4px 0 0; font-size: 17px; line-height: 1.35; }
p { display: -webkit-box; margin: 0; overflow: hidden; color: var(--muted-foreground); font-size: 13px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.progress { height: 5px; overflow: hidden; border-radius: 999px; background: var(--surface-muted); }
.progress span { display: block; height: 100%; border-radius: inherit; background: var(--primary); }
footer { align-items: center; color: var(--muted-foreground); font-size: 12px; }
.attention { display: inline-flex; align-items: center; gap: 5px; color: var(--warning-strong); font-weight: 700; }
</style>
