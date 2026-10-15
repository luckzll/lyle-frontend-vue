<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown, CircleAlert, CircleHelp, CircleMinus, CirclePause, CircleStop,
  Clock3, LoaderCircle, MessageSquareText } from '@lucide/vue'
import { AGENT_STEPS, type AgentStepEvent } from '@/domain/chat-progress'
import { agentStepFeedback } from '@/domain/chat-step-presentation'
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
function shouldDisclose(text: string) { return text.length > 280 || text.split('\n').length > 5 }
function detailNotice(status: string) {
  const notices: Record<string, string> = { failed: '此步骤未能完成。', awaiting_confirmation: '此操作需要你确认后才会执行。',
    needs_clarification: '需要补充信息后才能继续此操作。', interrupted: '本轮已中断，此步骤未完成。',
    ended: '本轮已结束，未收到此步骤的完成状态。', skipped: '本轮已跳过此操作。' }
  return notices[status] || ''
}
type Row = { type: 'reasoning'; id: string; kind: 'reasoning' | 'summary'; text: string; parts: ReturnType<typeof processTextParts> }
  | { type: 'agent' | 'tool'; id: string; title: string; tool?: string; status: string; statusLabel: string; durationMs?: number; detail?: string }
const rows = computed<Row[]>(() => timeline.value.flatMap<Row>(entry => {
  if (entry.type === 'reasoning') return [{ type: 'reasoning', id: entry.id, kind: entry.kind, text: entry.text, parts: processTextParts(entry.text) }]
  if (entry.type === 'tool') {
    const call = calls.value.find(item => item.callId === entry.id)
    if (!call) return []
    const status = toolCallDisplayStatus(call, running.value)
    return [{ type: 'tool', id: entry.id, title: call.title, tool: call.tool, status,
      statusLabel: TOOL_CALL_STATUS_LABELS[status], durationMs: call.durationMs,
      detail: call.status === 'running' && status === 'interrupted' ? '本轮已结束，未收到此操作的完成结果。'
        : call.summary?.trim() || { running: '正在执行操作，等待工具返回结果。', completed: '此操作已返回结果。',
          failed: '此操作执行失败，请查看返回信息。', awaiting_confirmation: '此操作需要你确认后才会执行。',
          needs_clarification: '需要补充信息后才能继续此操作。', interrupted: '本轮已中断，此操作未完成。',
          skipped: '本轮已跳过此操作。' }[status] }]
  }
  const item = props.items.find(step => step.step === entry.id)
  if (!item || item.status === 'skipped' || (item.step === 'tool_agent' && calls.value.length)) return []
  const status = item.status === 'running' && !running.value ? interrupted.value ? 'interrupted' : 'ended' : item.status
  return [{ type: 'agent', id: entry.id, title: AGENT_STEPS[item.step], status,
    statusLabel: { running: '进行中', completed: '已完成', failed: '失败', skipped: '已跳过', interrupted: '已中断', ended: '已结束' }[status],
    durationMs: item.durationMs, detail: agentStepFeedback(item, status) }]
}))
const stepCount = computed(() => rows.value.filter(row => row.type !== 'reasoning').length)
const headerTone = computed(() => interrupted.value ? 'interrupted'
  : calls.value.some(call => ['awaiting_confirmation', 'needs_clarification'].includes(call.status)) ? 'waiting'
    : completed.value ? 'completed' : running.value ? 'running' : 'ended')
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
      <span class="thinking-process__mark" :class="`is-${headerTone}`">
        <LoaderCircle v-if="running && headerTone === 'running'" :size="14" class="thinking-process__spinner" aria-hidden="true" />
        <Check v-else-if="headerTone === 'completed'" :size="14" aria-hidden="true" />
        <CirclePause v-else-if="headerTone === 'waiting'" :size="14" aria-hidden="true" />
        <CircleStop v-else-if="interrupted" :size="14" aria-hidden="true" />
        <CircleMinus v-else :size="14" aria-hidden="true" />
      </span>
      <span class="thinking-process__title">思考与执行过程</span>
      <span class="thinking-process__status" :class="`is-${headerTone}`" role="status" aria-live="polite" aria-atomic="true">
        {{ headerStatus }}
      </span>
      <span v-if="stepCount" class="thinking-process__count">{{ stepCount }} 个步骤</span>
      <span v-if="elapsedLabel" class="thinking-process__elapsed"><Clock3 :size="12" aria-hidden="true" />{{ elapsedLabel }}</span>
      <ChevronDown :size="15" class="thinking-process__chevron" :class="{ 'is-expanded': expanded }" aria-hidden="true" />
    </button>
    <div :id="panelId" class="thinking-process__body" :hidden="!expanded">
      <p v-if="legacyOrder" class="thinking-process__legacy">历史记录未保存发生顺序，以下为已记录的内容。</p>
      <ol v-if="rows.length" class="thinking-process__timeline" aria-label="思考与执行时间线">
        <li v-for="row in rows" :key="`${row.type}:${row.id}`" :data-process-type="row.type" :data-process-id="row.id"
          :data-agent="row.type === 'agent' ? row.id : undefined" :data-call-id="row.type === 'tool' ? row.id : undefined"
          :data-status="row.type !== 'reasoning' ? row.status : undefined"
          :class="[`thinking-process__row--${row.type}`, row.type !== 'reasoning' ? `is-${row.status}` : '']">
          <template v-if="row.type === 'reasoning'">
            <span class="thinking-process__step-icon thinking-process__step-icon--reasoning"><MessageSquareText :size="14" aria-hidden="true" /></span>
            <div class="thinking-process__step-copy">
              <span class="thinking-process__reasoning-label">{{ row.kind === 'summary' ? '思考摘要内容' : '模型思考内容' }}</span>
              <details v-if="shouldDisclose(row.text)" class="thinking-process__output">
                <summary>查看思考内容<ChevronDown :size="12" aria-hidden="true" /></summary>
                <p class="thinking-process__reasoning-text"><template v-for="(part, index) in row.parts" :key="index"><strong v-if="part.type === 'strong'">{{ part.text }}</strong><code v-else-if="part.type === 'code'">{{ part.text }}</code><template v-else>{{ part.text }}</template></template></p>
              </details>
              <p v-else class="thinking-process__reasoning-text"><template v-for="(part, index) in row.parts" :key="index"><strong v-if="part.type === 'strong'">{{ part.text }}</strong><code v-else-if="part.type === 'code'">{{ part.text }}</code><template v-else>{{ part.text }}</template></template></p>
            </div>
          </template>
          <template v-else>
            <span class="thinking-process__step-icon" :class="`is-${row.status}`">
              <CircleAlert v-if="row.status === 'failed'" :size="14" aria-hidden="true" />
              <CirclePause v-else-if="row.status === 'awaiting_confirmation'" :size="14" aria-hidden="true" />
              <CircleHelp v-else-if="row.status === 'needs_clarification'" :size="14" aria-hidden="true" />
              <CircleStop v-else-if="row.status === 'interrupted'" :size="14" aria-hidden="true" />
              <CircleMinus v-else-if="row.status === 'ended' || row.status === 'skipped'" :size="14" aria-hidden="true" />
              <LoaderCircle v-else-if="row.status === 'running'" :size="14" class="thinking-process__spinner" aria-hidden="true" />
              <Check v-else-if="row.status === 'completed'" :size="14" aria-hidden="true" />
            </span>
            <div class="thinking-process__step-copy">
              <details v-if="row.type === 'tool'" class="thinking-process__tool-details">
                <summary class="thinking-process__step-heading">
                  <span class="thinking-process__step-name">{{ row.title }}</span><span class="thinking-process__step-status" :class="[`is-${row.status}`, { 'thinking-process__sr-only': row.status === 'completed' }]">{{ row.statusLabel }}</span>
                  <span v-if="row.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(row.durationMs) }}</span><ChevronDown :size="12" aria-hidden="true" />
                </summary>
                <p class="thinking-process__tool-id">工具：<code>{{ row.tool }}</code></p>
              </details>
              <div v-else class="thinking-process__step-heading">
                <span class="thinking-process__step-name">{{ row.title }}</span><span class="thinking-process__step-status" :class="[`is-${row.status}`, { 'thinking-process__sr-only': row.status === 'completed' }]">{{ row.statusLabel }}</span>
                <span v-if="row.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(row.durationMs) }}</span>
              </div>
              <template v-if="row.detail">
                <template v-if="shouldDisclose(row.detail)">
                  <p v-if="detailNotice(row.status)" class="thinking-process__step-detail">{{ detailNotice(row.status) }}</p>
                  <details class="thinking-process__output">
                    <summary>查看输出详情<ChevronDown :size="12" aria-hidden="true" /></summary>
                    <p class="thinking-process__step-detail">{{ row.detail }}</p>
                  </details>
                </template>
                <p v-else class="thinking-process__step-detail">{{ row.detail }}</p>
              </template>
            </div>
          </template>
        </li>
      </ol>
      <p v-else-if="running" class="thinking-process__empty">正在准备本轮处理，收到步骤进度后会显示在这里。</p>
    </div>
  </section>
</template>

<style scoped>
.thinking-process { --process-primary: var(--primary); --process-warning: var(--lyle-color-amber-700); --process-danger: var(--danger-strong); width: 100%; min-width: 0; margin: 0 0 10px; color: var(--muted-foreground); font-size: 12px; }
:global(.dark .thinking-process) { --process-primary: var(--lyle-color-indigo-300); --process-warning: var(--lyle-color-amber-200); --process-danger: var(--lyle-color-rose-200); }
.thinking-process__toggle { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; width: 100%; min-height: 36px; padding: 6px 8px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; line-height: 1.6; }
.thinking-process__toggle:hover { background: color-mix(in srgb, var(--surface-muted) 65%, transparent); }
.thinking-process__toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.thinking-process__mark { display: flex; align-items: center; justify-content: center; flex: 0 0 16px; height: 18px; color: var(--muted-foreground); }
.thinking-process__mark.is-running { color: var(--process-primary); }
.thinking-process__mark.is-interrupted, .thinking-process__mark.is-waiting { color: var(--process-warning); }
.thinking-process__title { font-weight: 500; white-space: nowrap; }
.thinking-process__status { min-width: 0; max-width: 100%; overflow-wrap: anywhere; font-size: 11px; }
.thinking-process__status.is-running { color: var(--process-primary); }
.thinking-process__status.is-waiting, .thinking-process__status.is-interrupted { color: var(--process-warning); }
.thinking-process__count { margin-left: auto; font-size: 11px; white-space: nowrap; }
.thinking-process__elapsed { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 11px; font-variant-numeric: tabular-nums; }
.thinking-process__chevron { flex-shrink: 0; margin-left: auto; transition: transform 160ms ease; }
.thinking-process__count ~ .thinking-process__chevron, .thinking-process__elapsed + .thinking-process__chevron { margin-left: 0; }
.thinking-process__chevron.is-expanded { transform: rotate(180deg); }
.thinking-process__body { padding: 10px 8px 2px 16px; }
.thinking-process__body[hidden] { display: none; }
.thinking-process__legacy { margin: 0 0 10px; font-size: 11px; line-height: 1.7; }
.thinking-process__timeline { margin: 0; padding: 0 0 0 8px; list-style: none; }
.thinking-process__timeline > li { position: relative; display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 0 0 16px; }
.thinking-process__timeline > li::before { position: absolute; content: ''; width: 1px; top: 22px; bottom: 3px; left: 8px; background: var(--border); }
.thinking-process__timeline > li:last-child { padding-bottom: 4px; }
.thinking-process__timeline > li:last-child::before { display: none; }
.thinking-process__step-icon { position: relative; display: flex; align-items: center; justify-content: center; flex: 0 0 17px; height: 21px; color: var(--muted-foreground); }
.thinking-process__step-icon.is-running { color: var(--process-primary); }
.thinking-process__step-icon.is-failed { color: var(--process-danger); }
.thinking-process__step-icon.is-interrupted, .thinking-process__step-icon.is-awaiting_confirmation, .thinking-process__step-icon.is-needs_clarification { color: var(--process-warning); }
.thinking-process__step-copy { flex: 1; min-width: 0; }
.thinking-process__step-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 8px; line-height: 1.75; }
.thinking-process__step-name { color: var(--foreground); font-weight: 500; overflow-wrap: anywhere; }
.thinking-process__step-status { font-size: 11px; }
.thinking-process__step-status.is-running { color: var(--process-primary); }
.thinking-process__step-status.is-failed { color: var(--process-danger); }
.thinking-process__step-status.is-interrupted, .thinking-process__step-status.is-awaiting_confirmation, .thinking-process__step-status.is-needs_clarification { color: var(--process-warning); }
.thinking-process__step-duration { margin-left: auto; white-space: nowrap; font-size: 11px; font-variant-numeric: tabular-nums; }
.thinking-process__step-detail { margin: 4px 0 0; font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__reasoning-label { color: var(--foreground); font-weight: 500; font-size: 12px; }
.thinking-process__reasoning-text { margin: 4px 0 0; font-size: 12px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__reasoning-text strong { color: var(--foreground); font-weight: 600; }
.thinking-process__reasoning-text code { border-radius: 3px; padding: 1px 4px; background: var(--surface-muted); font-size: .94em; }
.thinking-process__tool-details summary, .thinking-process__output > summary { cursor: pointer; list-style: none; border-radius: 3px; }
.thinking-process__tool-details summary::-webkit-details-marker, .thinking-process__output > summary::-webkit-details-marker { display: none; }
.thinking-process__tool-details summary:focus-visible, .thinking-process__output > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.thinking-process__tool-details summary > svg, .thinking-process__output > summary > svg { flex-shrink: 0; align-self: center; transition: transform 160ms ease; }
.thinking-process__tool-details[open] summary > svg, .thinking-process__output[open] > summary > svg { transform: rotate(180deg); }
.thinking-process__tool-id { margin: 4px 0 0; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.thinking-process__output { margin-top: 4px; min-width: 0; }
.thinking-process__output > summary { display: flex; align-items: center; gap: 4px; width: fit-content; max-width: 100%; font-size: 11px; line-height: 1.8; }
.thinking-process__output > summary:hover { color: var(--foreground); }
.thinking-process__empty { margin: 0 0 8px; font-size: 12px; line-height: 1.75; }
.thinking-process__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.thinking-process__spinner { flex-shrink: 0; animation: thinking-process-spin 1.2s linear infinite; }
@keyframes thinking-process-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  .thinking-process__toggle { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 15px; gap: 2px 6px; padding: 6px; }
  .thinking-process__mark { grid-column: 1; grid-row: 1; }
  .thinking-process__title { grid-column: 2; grid-row: 1; font-size: 12px; }
  .thinking-process__status { grid-column: 2 / -1; grid-row: 2; max-width: 100%; }
  .thinking-process__count { display: none; }
  .thinking-process__elapsed { grid-column: 3; grid-row: 1; font-size: 10px; }
  .thinking-process__chevron, .thinking-process__elapsed + .thinking-process__chevron { grid-column: 4; grid-row: 1; margin-left: 0; }
  .thinking-process__body { padding: 8px 6px 2px; }
  .thinking-process__step-heading { gap: 3px 6px; }
  .thinking-process__step-duration { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) { .thinking-process__spinner { animation: none; } .thinking-process__chevron, .thinking-process__tool-details summary > svg, .thinking-process__output > summary > svg { transition: none; } }
</style>
