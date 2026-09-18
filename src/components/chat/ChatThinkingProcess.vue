<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown, CircleAlert, CircleHelp, CircleMinus, CirclePause, CircleStop, LoaderCircle } from '@lucide/vue'
import { AGENT_STEPS, type AgentStepEvent } from '@/domain/chat-progress'
import type { ChatReasoning } from '@/domain/chat-reasoning'
import { formatTraceDuration } from '@/domain/chat-trace-presentation'
import { TOOL_CALL_STATUS_LABELS, toolCallDisplayStatus, type ChatToolCall } from '@/domain/chat-tool-calls'
import { processTextParts, sanitizeProcessTimeline, type ProcessTimelineEntry } from '@/domain/chat-process-timeline'

const props = defineProps<{ items: AgentStepEvent[]; toolCalls?: ChatToolCall[]; processTimeline?: ProcessTimelineEntry[];
  reasoning?: ChatReasoning; phase?: string; active?: boolean; statusText?: string; startedAt?: number; completedAt?: number }>()
const panelId = `thinking-process-${useId()}`
const interrupted = computed(() => ['FAILED', 'CANCELLED', 'CANCELED'].includes(props.phase || ''))
const completed = computed(() => props.phase === 'COMPLETED')
const running = computed(() => Boolean(props.active) && !interrupted.value && !completed.value)
const expanded = ref(running.value)
const manuallyToggled = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
const calls = computed(() => props.toolCalls || [])
const reasoningText = computed(() => props.reasoning?.text.trim() ? props.reasoning.text : '')
const timeline = computed(() => {
  const saved = sanitizeProcessTimeline(props.processTimeline, props.items, calls.value)
  if (saved !== undefined) return saved
  // Legacy snapshots cannot establish the original order between independent event streams.
  const fallback: ProcessTimelineEntry[] = [
    ...props.items.map(item => ({ type: 'agent' as const, id: item.step })),
    ...calls.value.map(call => ({ type: 'tool' as const, id: call.callId }))
  ]
  if (reasoningText.value) fallback.push({ type: 'reasoning', id: 'legacy-reasoning', text: reasoningText.value,
    kind: props.reasoning!.kind, sequence: props.reasoning!.sequence })
  return fallback
})
const legacyOrder = computed(() => props.processTimeline === undefined && timeline.value.length > 1)
type Row = { type: 'reasoning'; id: string; kind: 'reasoning' | 'summary'; parts: ReturnType<typeof processTextParts> }
  | { type: 'agent' | 'tool'; id: string; title: string; tool?: string; status: string; statusLabel: string; durationMs?: number; detail?: string }
const rows = computed<Row[]>(() => timeline.value.flatMap<Row>(entry => {
  if (entry.type === 'reasoning') return [{ type: 'reasoning', id: entry.id, kind: entry.kind, parts: processTextParts(entry.text) }]
  if (entry.type === 'tool') {
    const call = calls.value.find(item => item.callId === entry.id)
    if (!call) return []
    const status = toolCallDisplayStatus(call, running.value)
    return [{ type: 'tool', id: entry.id, title: call.title, tool: call.tool, status,
      statusLabel: TOOL_CALL_STATUS_LABELS[status], durationMs: call.durationMs,
      detail: call.status === 'running' && status === 'interrupted' ? '本轮已结束，未收到此操作的完成结果。' : call.summary }]
  }
  const item = props.items.find(step => step.step === entry.id)
  if (!item || item.status === 'skipped' || (item.step === 'tool_agent' && calls.value.length)) return []
  const status = item.status === 'running' && !running.value ? interrupted.value ? 'interrupted' : 'ended' : item.status
  return [{ type: 'agent', id: entry.id, title: AGENT_STEPS[item.step], status,
    statusLabel: { running: '进行中', completed: '已完成', failed: '失败', skipped: '已跳过', interrupted: '已中断', ended: '已结束' }[status],
    durationMs: item.durationMs, detail: status === 'interrupted' ? '本轮已中断，此步骤未完成'
      : status === 'ended' ? '本轮已结束，未收到此步骤的完成状态'
        : item.summary && !['步骤已完成', '本轮无需执行此步骤'].includes(item.summary) ? item.summary : undefined }]
}))
const visible = computed(() => running.value || timeline.value.length > 0)
const headerStatus = computed(() => {
  if (interrupted.value) return '已中断'
  if (calls.value.some(call => call.status === 'awaiting_confirmation')) return '等待确认'
  if (calls.value.some(call => call.status === 'needs_clarification')) return '等待补充信息'
  if (completed.value) return '已完成'
  if (!running.value) return '已结束'
  const currentCalls = calls.value.filter(call => call.status === 'running')
  if (currentCalls.length) return currentCalls.map(call => call.title).join('、')
  if (props.statusText?.trim()) return props.statusText
  const currentSteps = props.items.filter(item => item.status === 'running')
  if (currentSteps.length) return currentSteps.map(item => AGENT_STEPS[item.step]).join('、')
  return reasoningText.value ? '正在思考' : '正在处理'
})
const elapsedLabel = computed(() => {
  const start = props.startedAt
  const end = props.completedAt ?? (running.value ? now.value : undefined)
  if (typeof start !== 'number' || !Number.isFinite(start) || start <= 0
    || typeof end !== 'number' || !Number.isFinite(end) || end < start) return ''
  const seconds = Math.floor((end - start) / 1000)
  return seconds < 60 ? `用时 ${seconds} 秒` : `用时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
})
function toggleExpanded() { manuallyToggled.value = true; expanded.value = !expanded.value }
watch(running, (active, previous) => {
  if (active && !previous) { manuallyToggled.value = false; expanded.value = true }
  else if (!active && !manuallyToggled.value) expanded.value = false
}, { immediate: true })
onMounted(() => {
  watch(running, active => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (active) { now.value = Date.now(); timer = setInterval(() => { now.value = Date.now() }, 1000) }
  }, { immediate: true })
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section v-if="visible" class="thinking-process" :class="{ 'is-active': running }" aria-label="思考与执行过程" data-testid="chat-thinking-process">
    <button type="button" class="thinking-process__toggle" :aria-expanded="expanded" :aria-controls="panelId" @click="toggleExpanded">
      <LoaderCircle v-if="running" :size="15" class="thinking-process__spinner" aria-hidden="true" />
      <CircleStop v-else-if="interrupted" :size="15" aria-hidden="true" />
      <span class="thinking-process__title">思考与执行过程</span>
      <span class="thinking-process__status" role="status" aria-live="polite" aria-atomic="true">{{ headerStatus }}</span>
      <span v-if="elapsedLabel" class="thinking-process__elapsed">{{ elapsedLabel }}</span>
      <ChevronDown :size="14" class="thinking-process__chevron" :class="{ 'is-expanded': expanded }" aria-hidden="true" />
    </button>
    <div :id="panelId" class="thinking-process__body" :hidden="!expanded">
      <p v-if="legacyOrder" class="thinking-process__legacy">历史记录未保存发生顺序，以下为已记录的内容。</p>
      <ol v-if="rows.length" class="thinking-process__timeline" aria-label="思考与执行时间线">
        <li v-for="row in rows" :key="`${row.type}:${row.id}`" :data-process-type="row.type" :data-process-id="row.id"
          :data-agent="row.type === 'agent' ? row.id : undefined" :data-call-id="row.type === 'tool' ? row.id : undefined"
          :data-status="row.type !== 'reasoning' ? row.status : undefined" :class="`thinking-process__row--${row.type}`">
          <template v-if="row.type === 'reasoning'">
            <span class="thinking-process__sr-only">{{ row.kind === 'summary' ? '思考摘要内容' : '模型思考内容' }}</span>
            <p class="thinking-process__reasoning-text"><template v-for="(part, index) in row.parts" :key="index"><strong v-if="part.type === 'strong'">{{ part.text }}</strong><code v-else-if="part.type === 'code'">{{ part.text }}</code><template v-else>{{ part.text }}</template></template></p>
          </template>
          <template v-else>
            <span class="thinking-process__step-icon" :class="`is-${row.status}`">
              <LoaderCircle v-if="row.status === 'running'" :size="14" class="thinking-process__spinner" aria-hidden="true" />
              <Check v-else-if="row.status === 'completed'" :size="14" aria-hidden="true" />
              <CircleAlert v-else-if="row.status === 'failed'" :size="14" aria-hidden="true" />
              <CirclePause v-else-if="row.status === 'awaiting_confirmation'" :size="14" aria-hidden="true" />
              <CircleHelp v-else-if="row.status === 'needs_clarification'" :size="14" aria-hidden="true" />
              <CircleStop v-else-if="row.status === 'interrupted'" :size="14" aria-hidden="true" />
              <CircleMinus v-else :size="14" aria-hidden="true" />
            </span>
            <div class="thinking-process__step-copy">
              <details v-if="row.type === 'tool'" class="thinking-process__tool-details">
                <summary class="thinking-process__step-heading">
                  <span class="thinking-process__step-name">{{ row.title }}</span><span class="thinking-process__step-status">{{ row.statusLabel }}</span>
                  <span v-if="row.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(row.durationMs) }}</span><ChevronDown :size="12" aria-hidden="true" />
                </summary>
                <p class="thinking-process__tool-id">工具：<code>{{ row.tool }}</code></p>
              </details>
              <div v-else class="thinking-process__step-heading">
                <span class="thinking-process__step-name">{{ row.title }}</span><span class="thinking-process__step-status">{{ row.statusLabel }}</span>
                <span v-if="row.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(row.durationMs) }}</span>
              </div>
              <p v-if="row.detail" class="thinking-process__step-detail">{{ row.detail }}</p>
            </div>
          </template>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.thinking-process { width: 100%; min-width: 0; margin: 0 0 16px; color: var(--muted-foreground); font-size: 13px; }
.thinking-process__toggle { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 9px; width: 100%; min-height: 38px; padding: 4px 0; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; line-height: 1.6; }
.thinking-process__toggle:hover { color: var(--foreground); }
.thinking-process__toggle:focus-visible, .thinking-process__tool-details summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.thinking-process__toggle > svg { flex-shrink: 0; }
.thinking-process__title { font-weight: 500; }
.thinking-process__status { min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
.thinking-process__status::before { content: '·'; margin-right: 9px; }
.thinking-process__elapsed { margin-left: auto; white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.thinking-process__chevron { transition: transform 160ms ease; }
.thinking-process__chevron.is-expanded { transform: rotate(180deg); }
.thinking-process__body { border-top: 1px solid var(--border); padding: 14px 0 4px; }
.thinking-process__body[hidden] { display: none; }
.thinking-process__legacy { margin: 0 0 12px; font-size: 11px; line-height: 1.7; }
.thinking-process__timeline { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.thinking-process__timeline > li { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.thinking-process__timeline > .thinking-process__row--reasoning { display: block; padding: 2px 0; }
.thinking-process__reasoning-text { margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__reasoning-text strong { font-weight: 600; }
.thinking-process__reasoning-text code { font-size: .94em; }
.thinking-process__step-icon { display: flex; flex: 0 0 16px; justify-content: center; padding-top: 4px; }
.thinking-process__step-icon.is-failed { color: var(--danger-strong); }
.thinking-process__step-icon.is-interrupted, .thinking-process__step-icon.is-awaiting_confirmation, .thinking-process__step-icon.is-needs_clarification { color: var(--warning-strong); }
.thinking-process__step-copy { flex: 1; min-width: 0; }
.thinking-process__step-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; line-height: 1.7; }
.thinking-process__step-name { overflow-wrap: anywhere; }
.thinking-process__row--tool .thinking-process__step-name { color: var(--foreground); font-weight: 500; }
.thinking-process__step-status, .thinking-process__step-duration { font-size: 11px; }
.thinking-process__step-duration { margin-left: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.thinking-process__step-detail { margin: 3px 0 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__tool-details summary { cursor: pointer; list-style: none; }
.thinking-process__tool-details summary::-webkit-details-marker { display: none; }
.thinking-process__tool-details summary > svg { flex-shrink: 0; align-self: center; }
.thinking-process__tool-details[open] summary > svg { transform: rotate(180deg); }
.thinking-process__tool-id { margin: 6px 0 0; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.thinking-process__sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.thinking-process__spinner { animation: thinking-process-spin 1.2s linear infinite; }
@keyframes thinking-process-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  .thinking-process__toggle { gap: 5px 7px; }
  .thinking-process__status { flex-basis: calc(100% - 24px); order: 4; margin-left: 24px; }
  .thinking-process__status::before { content: none; }
}
@media (prefers-reduced-motion: reduce) { .thinking-process__spinner { animation: none; } .thinking-process__chevron { transition: none; } }
</style>
