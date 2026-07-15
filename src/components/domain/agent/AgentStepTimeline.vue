<script setup lang="ts">
import { computed } from 'vue'
import { Check, Circle, CircleAlert, Clock3, LoaderCircle, Pause } from '@lucide/vue'
import type { AgentPlanStep, AgentStepRun } from '@/api/agentTasks'
import { safeAgentStepSummary } from '@/features/agentOutput'

const props = withDefaults(defineProps<{ steps: AgentPlanStep[]; runs?: AgentStepRun[] }>(), { runs: () => [] })
const rows = computed(() => props.steps.map((step) => {
  const attempts = props.runs.filter((run) => run.stepKey === step.stepKey)
  const run = attempts[attempts.length - 1]
  return { step, run, status: run?.status || 'PENDING' }
}))

function icon(status: string) {
  if (status === 'SUCCEEDED') return Check
  if (status === 'RUNNING') return LoaderCircle
  if (status === 'FAILED' || status === 'CANCELLED') return CircleAlert
  if (status.startsWith('WAITING')) return Clock3
  if (status === 'READY') return Pause
  return Circle
}

</script>

<template>
  <ol class="timeline" aria-label="执行步骤">
    <li v-for="row in rows" :key="row.step.stepKey" :class="row.status.toLowerCase()">
      <span class="icon"><component :is="icon(row.status)" :size="16" aria-hidden="true" /></span>
      <div>
        <header><strong>{{ row.step.position }}. {{ row.step.title }}</strong><small>{{ row.status }}</small></header>
        <p>{{ row.step.purpose }}</p>
        <p v-if="safeAgentStepSummary(row.run, row.step.toolRef)" class="summary">{{ safeAgentStepSummary(row.run, row.step.toolRef) }}</p>
        <footer><span>{{ row.step.toolRef }}</span><span>{{ row.step.riskLevel === 'WRITE_LOW' ? '写入前确认' : '只读' }}</span></footer>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.timeline { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
li { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: var(--space-3); padding-bottom: var(--space-5); }
li:not(:last-child)::before { position: absolute; top: 26px; bottom: 0; left: 15px; width: 1px; background: var(--border); content: ''; }
.icon { z-index: 1; display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--muted-foreground); }
.succeeded .icon { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.running .icon { border-color: var(--info-border); background: var(--info-soft); color: var(--info-strong); }
.failed .icon, .cancelled .icon { border-color: var(--danger-border); background: var(--danger-soft); color: var(--danger-strong); }
.waiting_confirmation .icon, .waiting_input .icon { border-color: var(--warning-border); background: var(--warning-soft); color: var(--warning-strong); }
.running .icon svg { animation: spin 1s linear infinite; }
header, footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
header strong { font-size: 14px; }
small, footer { color: var(--muted-foreground); font-size: 11px; }
p { margin: 5px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.55; }
.summary { border-left: 2px solid var(--primary-border); padding-left: var(--space-2); color: var(--foreground); }
footer { justify-content: flex-start; margin-top: var(--space-2); }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
