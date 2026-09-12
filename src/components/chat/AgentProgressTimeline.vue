<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_STEPS, agentProgressDetail, agentProgressDisplayStatus, agentProgressLabel, stageTimingLabel, type AgentStepEvent } from '@/domain/chat-progress'
import { formatTraceDuration } from '@/domain/chat-trace-presentation'

const props = defineProps<{ items: AgentStepEvent[]; active?: boolean; phase?: string }>()
const steps = computed(() => props.items.map(item => ({
  ...item, label: AGENT_STEPS[item.step], displayStatus: agentProgressDisplayStatus(item, props.phase),
  detail: item.status === 'running' && props.phase === 'FAILED' ? agentProgressDetail(props.items, item.step, props.phase) : item.summary
})))
</script>

<template>
  <div class="live-agent-progress" data-testid="live-agent-progress">
    <p>{{ active ? '步骤状态实时更新，最终证据将在本轮结束后汇总。' : '以下为已收到的步骤状态。' }}</p>
    <ol aria-label="实时 Agent 步骤">
      <li v-for="item in steps" :key="item.step" :data-agent="item.step" :data-status="item.displayStatus">
        <details>
          <summary>
            <strong>{{ item.label }}</strong>
            <span class="live-step-state" :class="`is-${item.displayStatus}`">{{ agentProgressLabel(item.displayStatus) }}</span>
            <span class="live-step-duration">{{ formatTraceDuration(item.durationMs) }}</span>
          </summary>
          <p v-if="item.detail">{{ item.detail }}</p>
          <dl v-if="item.timings && Object.keys(item.timings).length" class="live-step-timings">
            <template v-for="(duration, name) in item.timings" :key="name">
              <dt>{{ stageTimingLabel(name) }}</dt><dd>{{ formatTraceDuration(duration) }}</dd>
            </template>
          </dl>
          <p v-if="!item.detail && !Object.keys(item.timings || {}).length">尚无该步骤的详细结果。</p>
        </details>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.live-agent-progress { min-width: 0; }
.live-agent-progress p { margin: 8px 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.live-agent-progress > p { margin-top: 0; }
.live-agent-progress ol { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
.live-agent-progress li { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--surface); }
.live-agent-progress summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; cursor: pointer; font-size: 13px; }
.live-agent-progress summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.live-step-state { padding: 2px 6px; border-radius: 5px; font-size: 11px; color: var(--muted-foreground); background: var(--surface-muted); }
.is-running { color: var(--primary); background: var(--primary-soft); }
.is-completed { color: #047857; background: #ecfdf5; }
.is-failed { color: #b91c1c; background: #fef2f2; }
.is-interrupted { color: #92400e; background: #fffbeb; }
.live-step-duration { margin-left: auto; color: var(--muted-foreground); font-size: 12px; font-variant-numeric: tabular-nums; }
.live-step-timings { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; margin: 12px 0 0; font-size: 12px; color: var(--muted-foreground); }
.live-step-timings dt { overflow-wrap: anywhere; }
.live-step-timings dd { margin: 0; font-variant-numeric: tabular-nums; }
</style>
