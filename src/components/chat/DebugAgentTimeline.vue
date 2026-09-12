<script setup lang="ts">
import { computed } from 'vue'
import { BrainCircuit, Check, ChevronRight, Clock3, Database, FileStack, FolderSearch, GitBranch, ShieldCheck, Sparkles, Wrench } from '@lucide/vue'
import type { AgentTraceItem, ProjectChatContext } from '@/api/types'
import { formatTraceDuration, presentAgentTrace } from '@/domain/chat-trace-presentation'
import { stageTimingLabel } from '@/domain/chat-progress'

const props = defineProps<{
  items: AgentTraceItem[]
  projectContext?: ProjectChatContext
  review?: Record<string, unknown>
  formatDetail: (item: AgentTraceItem) => string
}>()

const steps = computed(() => {
  const lastReviewer = props.items.map(item => item.agent).lastIndexOf('reviewer_agent')
  return props.items.map((item, index) => ({
    item,
    ...presentAgentTrace(item, {
      projectContext: props.projectContext,
      review: index === lastReviewer ? props.review : undefined
    })
  }))
})

const reviewReason = computed(() => props.review?.reason === 'Reviewer disabled'
  ? '模型复核未开启，本轮未执行模型复核。'
  : String(props.review?.reason || '未保存审核原因'))
const reviewRule = computed(() => ({
  connector_failure: '连接器失败检查',
  plan_confirmation: '长任务确认检查',
  project_fact_grounding: '项目事实来源检查',
  project_clarification: '项目归属澄清检查'
} as Record<string, string>)[String(props.review?.v3Rule || '')] || (props.review?.ruleBlocked ? '基础规则拦截' : ''))
const reviewLabel = computed(() => props.review?.approved === false || props.review?.ruleBlocked === true ? '未通过'
  : props.review?.skipped === true ? '模型复核已跳过'
  : props.review?.approved === true ? '已通过' : '结果未记录')

function stepIcon(agent: string) {
  return ({
    supervisor_agent: GitBranch,
    memory_agent: BrainCircuit,
    rag_agent: Database,
    tool_agent: Wrench,
    gather_agent: FileStack,
    project_resolver: FolderSearch,
    writer_agent: Sparkles,
    reviewer_agent: ShieldCheck
  } as Record<string, typeof GitBranch>)[agent] || GitBranch
}
</script>

<template>
  <div class="debug-flow" data-testid="debug-agent-timeline">
    <p v-if="steps.length" class="debug-flow-hint">按执行顺序记录，展开步骤可查看说明与诊断详情。</p>
    <ol v-if="steps.length" class="debug-flow-list" aria-label="Agent 执行流程">
      <li v-for="(step, index) in steps" :key="`${index}-${step.item.agent}`">
        <details class="debug-flow-step" :data-tone="step.tone" :data-agent="step.item.agent">
          <summary>
            <span class="debug-flow-icon"><component :is="stepIcon(step.item.agent)" :size="18" aria-hidden="true" /></span>
            <span class="debug-flow-content">
              <span class="debug-flow-title">
                <span class="debug-flow-number">{{ String(index + 1).padStart(2, '0') }}</span>
                <strong>{{ step.name }}</strong>
                <span class="debug-flow-status" :data-tone="step.tone">
                  <Check v-if="step.tone === 'success'" :size="12" aria-hidden="true" />{{ step.statusLabel }}
                </span>
              </span>
              <span class="debug-flow-result">{{ step.summary }}</span>
            </span>
            <span class="debug-flow-meta">
              <span v-if="step.duration" class="debug-flow-duration"><Clock3 :size="12" aria-hidden="true" />{{ step.duration }}</span>
              <ChevronRight class="debug-flow-chevron" :size="16" aria-hidden="true" />
            </span>
          </summary>
          <div class="debug-flow-detail">
            <p><strong>这一步做什么</strong>{{ step.purpose }}</p>
            <div class="debug-flow-technical">
              <span>节点标识 <code>{{ step.item.agent }}</code></span>
              <span>{{ step.duration ? `耗时 ${step.duration}` : '耗时未记录' }}</span>
            </div>
            <dl v-if="step.item.timings && Object.keys(step.item.timings).length" class="debug-flow-timings">
              <template v-for="(duration, name) in step.item.timings" :key="name">
                <dt>{{ stageTimingLabel(name) }}</dt><dd>{{ formatTraceDuration(duration) }}</dd>
              </template>
            </dl>
            <details v-if="formatDetail(step.item)" class="debug-flow-raw">
              <summary>查看诊断字段</summary>
              <pre>{{ formatDetail(step.item) }}</pre>
            </details>
          </div>
        </details>
      </li>
    </ol>
    <details v-if="review && Object.keys(review).length" class="debug-flow-review" data-testid="debug-review-details">
      <summary><ShieldCheck :size="15" aria-hidden="true" /><strong>规则与审核详情</strong><span>{{ reviewLabel }}</span><ChevronRight :size="15" aria-hidden="true" /></summary>
      <div class="debug-flow-review-body">
        <p v-if="reviewRule"><strong>检查项：</strong>{{ reviewRule }}</p>
        <p>{{ reviewReason }}</p>
        <p v-if="typeof review.score === 'number'"><strong>记录分数：</strong>{{ review.score }}</p>
        <p v-if="review.rewrite_instruction"><strong>修订要求：</strong>{{ review.rewrite_instruction }}</p>
        <details class="debug-flow-raw"><summary>查看审核诊断字段</summary><pre>{{ JSON.stringify(review, null, 2) }}</pre></details>
      </div>
    </details>
  </div>
</template>

<style scoped>
.debug-flow { min-width: 0; }
.debug-flow-hint { margin: 0 0 12px; color: var(--muted-foreground, #64748b); font-size: 11px; line-height: 1.6; }
.debug-flow-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.debug-flow-list > li { min-width: 0; }
.debug-flow-step { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; background: var(--surface, #fff); overflow: hidden; }
.debug-flow-step > summary { display: flex; align-items: flex-start; gap: 12px; padding: 13px 14px; cursor: pointer; list-style: none; transition: background 150ms; }
.debug-flow-step > summary::-webkit-details-marker { display: none; }
.debug-flow-step > summary:hover { background: var(--surface-muted, #f8fafc); }
.debug-flow-step > summary:focus-visible { outline: 2px solid var(--primary, #5b5ce2); outline-offset: -3px; border-radius: 9px; }
.debug-flow-icon { display: flex; flex: 0 0 34px; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 9px; color: var(--primary, #5b5ce2); background: var(--primary-soft, #eef2ff); }
.debug-flow-content { min-width: 0; flex: 1; }
.debug-flow-title { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; min-height: 22px; }
.debug-flow-number { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--muted-foreground, #64748b); }
.debug-flow-title strong { color: var(--foreground, #1f2937); font-size: 13px; font-weight: 650; }
.debug-flow-status { display: inline-flex; align-items: center; gap: 3px; border-radius: 5px; padding: 1px 6px; color: #526175; background: #f1f5f9; font-size: 10px; font-weight: 600; line-height: 1.7; }
.debug-flow-status[data-tone='success'] { color: #047857; background: #ecfdf5; }
.debug-flow-status[data-tone='warning'] { color: #92400e; background: #fffbeb; }
.debug-flow-status[data-tone='danger'] { color: #b91c1c; background: #fef2f2; }
.debug-flow-status[data-tone='running'] { color: var(--primary, #5b5ce2); background: var(--primary-soft, #eef2ff); }
.debug-flow-result { display: block; margin-top: 3px; color: var(--muted-foreground, #64748b); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.debug-flow-meta { display: flex; align-items: center; flex: 0 0 auto; gap: 10px; min-height: 22px; color: var(--muted-foreground, #64748b); }
.debug-flow-duration { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.debug-flow-chevron { transition: transform 150ms; }
.debug-flow-step[open] > summary .debug-flow-chevron { transform: rotate(90deg); }
.debug-flow-step[open] > summary { background: var(--surface-muted, #f8fafc); }
.debug-flow-detail { display: grid; min-width: 0; gap: 10px; border-top: 1px solid var(--border, #e2e8f0); padding: 14px 16px 16px 60px; font-size: 12px; }
.debug-flow-detail p { margin: 0; line-height: 1.7; color: var(--muted-foreground, #64748b); overflow-wrap: anywhere; }
.debug-flow-detail p > strong { display: block; margin-bottom: 4px; color: var(--foreground, #334155); font-size: 11px; }
.debug-flow-technical { display: flex; flex-wrap: wrap; gap: 8px 18px; color: var(--muted-foreground, #64748b); font-size: 11px; overflow-wrap: anywhere; }
.debug-flow-technical code { padding: 2px 5px; border-radius: 4px; background: var(--surface-muted, #f1f5f9); color: var(--foreground, #334155); }
.debug-flow-timings { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; margin: 0; color: var(--muted-foreground); font-size: 12px; }
.debug-flow-timings dt { overflow-wrap: anywhere; }
.debug-flow-timings dd { margin: 0; font-variant-numeric: tabular-nums; }
.debug-flow-raw { min-width: 0; }
.debug-flow-raw > summary { cursor: pointer; color: var(--primary, #5b5ce2); font-size: 11px; padding: 3px 0; }
.debug-flow-raw pre { max-height: 260px; overflow: auto; margin: 8px 0 0; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
.debug-flow-review { margin-top: 14px; border-top: 1px solid var(--border, #e2e8f0); color: var(--muted-foreground, #64748b); }
.debug-flow-review > summary { display: flex; align-items: center; gap: 8px; padding: 13px 2px 4px; cursor: pointer; list-style: none; font-size: 11px; }
.debug-flow-review > summary::-webkit-details-marker { display: none; }
.debug-flow-review > summary strong { color: var(--foreground, #334155); }
.debug-flow-review > summary span { margin-left: auto; }
.debug-flow-review[open] > summary > svg:last-child { transform: rotate(90deg); }
.debug-flow-review-body { display: grid; gap: 8px; padding: 12px 2px 2px; }
.debug-flow-review-body p { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }
@container (max-width: 540px) {
  .debug-flow-step > summary { gap: 9px; padding: 12px 10px; }
  .debug-flow-icon { flex-basis: 28px; width: 28px; height: 28px; border-radius: 7px; }
  .debug-flow-title { gap: 5px; }
  .debug-flow-meta { flex-direction: column-reverse; gap: 7px; }
  .debug-flow-duration { font-size: 9px; gap: 2px; }
  .debug-flow-detail { padding: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .debug-flow-step > summary, .debug-flow-chevron { transition: none; }
}
</style>
