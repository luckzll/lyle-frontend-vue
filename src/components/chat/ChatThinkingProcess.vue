<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { BookOpen, BrainCircuit, Check, ChevronDown, CircleAlert, CircleHelp, CircleMinus, CirclePause, CircleStop,
  Clock3, Database, FolderSearch, Layers, LoaderCircle, MessageSquareText, PenLine, ShieldCheck, Workflow, Wrench } from '@lucide/vue'
import { AGENT_STEPS, type AgentStepEvent } from '@/domain/chat-progress'
import { agentStepFeedback, agentStepNeedsClarification, agentStepPresentation } from '@/domain/chat-step-presentation'
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
function shouldDisclose(text: string) { return text.length > 280 || text.split('\n').length > 5 }
const stepIcons = { supervisor_agent: Workflow, memory_agent: Database, rag_agent: BookOpen, tool_agent: Wrench,
  gather_agent: Layers, project_resolver: FolderSearch, writer_agent: PenLine, reviewer_agent: ShieldCheck }
function stepIcon(type: 'agent' | 'tool', id: string) {
  return type === 'tool' ? Wrench : stepIcons[id as keyof typeof stepIcons] || Workflow
}
function detailNotice(status: string) {
  const notices: Record<string, string> = { failed: '此步骤未能完成。', awaiting_confirmation: '此操作需要你确认后才会执行。',
    needs_clarification: '需要补充信息后才能继续此操作。', interrupted: '本轮已中断，此步骤未完成。',
    ended: '本轮已结束，未收到此步骤的完成状态。', skipped: '本轮已跳过此操作。' }
  return notices[status] || ''
}
type Row = { type: 'reasoning'; id: string; kind: 'reasoning' | 'summary'; text: string; parts: ReturnType<typeof processTextParts> }
  | { type: 'agent' | 'tool'; id: string; scope: 'action' | 'internal'; title: string; tool?: string; status: string; statusLabel: string; durationMs?: number; detail?: string }
const recordedRows = computed<Row[]>(() => timeline.value.flatMap<Row>(entry => {
  if (entry.type === 'reasoning') return [{ type: 'reasoning', id: entry.id, kind: entry.kind, text: entry.text, parts: processTextParts(entry.text) }]
  if (entry.type === 'tool') {
    const call = calls.value.find(item => item.callId === entry.id)
    if (!call) return []
    const status = toolCallDisplayStatus(call, running.value)
    return [{ type: 'tool', id: entry.id, scope: 'action', title: call.title, tool: call.tool, status,
      statusLabel: TOOL_CALL_STATUS_LABELS[status], durationMs: call.durationMs,
      detail: call.status === 'running' && status === 'interrupted' ? '本轮已结束，未收到此操作的完成结果。'
        : call.summary?.trim() || { running: '正在执行操作，等待工具返回结果。', completed: '此操作已返回结果。',
          failed: '此操作执行失败，请查看返回信息。', awaiting_confirmation: '此操作需要你确认后才会执行。',
          needs_clarification: '需要补充信息后才能继续此操作。', interrupted: '本轮已中断，此操作未完成。',
          skipped: '本轮已跳过此操作。' }[status] }]
  }
  const item = props.items.find(step => step.step === entry.id)
  if (!item) return []
  const scope = agentStepPresentation(item, calls.value.length > 0)
  if (scope === 'hidden') return []
  const status = item.status === 'running' && !running.value ? interrupted.value ? 'interrupted' : 'ended'
    : agentStepNeedsClarification(item) ? 'needs_clarification' : item.status
  return [{ type: 'agent', id: entry.id, scope, title: AGENT_STEPS[item.step], status,
    statusLabel: { running: '进行中', completed: '已完成', failed: '失败', skipped: '已跳过', interrupted: '已中断', ended: '已结束', needs_clarification: '待确认归属' }[status],
    durationMs: item.durationMs, detail: status === 'needs_clarification' ? item.summary : agentStepFeedback(item, status) }]
}))
const rows = computed(() => recordedRows.value.filter(row => row.type === 'reasoning' || row.scope === 'action'))
const internalRows = computed(() => recordedRows.value.filter((row): row is Extract<Row, { type: 'agent' | 'tool' }> => row.type !== 'reasoning' && row.scope === 'internal'))
const legacyOrder = computed(() => props.processTimeline === undefined && rows.value.length > 1)
const stepCount = computed(() => rows.value.filter(row => row.type !== 'reasoning').length)
const waitingForConfirmation = computed(() => rows.value.some(row => row.type !== 'reasoning' && row.status === 'awaiting_confirmation'))
const waitingForClarification = computed(() => rows.value.some(row => row.type !== 'reasoning' && row.status === 'needs_clarification'))
const hasFailedAction = computed(() => recordedRows.value.some(row => row.type !== 'reasoning' && row.status === 'failed'))
const headerTone = computed(() => interrupted.value ? 'interrupted'
  : waitingForConfirmation.value || waitingForClarification.value ? 'waiting'
    : hasFailedAction.value ? 'failed' : completed.value ? 'completed' : running.value ? 'running' : 'ended')
const visible = computed(() => running.value || interrupted.value || rows.value.length > 0)
const headerStatus = computed(() => {
  if (interrupted.value) return '已中断'
  if (waitingForConfirmation.value) return '等待确认'
  if (waitingForClarification.value) return '等待补充信息'
  if (hasFailedAction.value) return '有操作未完成'
  if (completed.value) return '已完成'
  if (!running.value) return '已结束'
  const currentCalls = calls.value.filter(call => call.status === 'running')
  if (currentCalls.length) return currentCalls.map(call => call.title).join('、')
  if (props.statusText?.trim()) return props.statusText
  const currentSteps = rows.value.filter(row => row.type !== 'reasoning' && row.status === 'running')
  if (currentSteps.length) return currentSteps.map(row => row.type === 'reasoning' ? '' : row.title).join('、')
  return reasoningText.value || rows.value.some(row => row.type === 'reasoning') ? '正在思考' : '正在回答'
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
  <section v-if="visible" class="thinking-process" :class="{ 'is-active': running, 'is-simple': !rows.length }" aria-label="思考与执行过程" data-testid="chat-thinking-process">
    <button v-if="rows.length" type="button" class="thinking-process__toggle" :aria-expanded="expanded" :aria-controls="panelId" @click="toggleExpanded">
      <span class="thinking-process__mark" :class="`is-${headerTone}`">
        <BrainCircuit :size="18" aria-hidden="true" />
      </span>
      <span class="thinking-process__title">思考与执行过程</span>
      <span class="thinking-process__status" :class="`is-${headerTone}`" role="status" aria-live="polite" aria-atomic="true">
        <LoaderCircle v-if="running && headerTone === 'running'" :size="12" class="thinking-process__spinner" aria-hidden="true" />
        <Check v-else-if="headerTone === 'completed'" :size="12" aria-hidden="true" />
        <CirclePause v-else-if="headerTone === 'waiting'" :size="12" aria-hidden="true" />
        <CircleAlert v-else-if="headerTone === 'failed'" :size="12" aria-hidden="true" />
        <CircleStop v-else-if="interrupted" :size="12" aria-hidden="true" />
        {{ headerStatus }}
      </span>
      <span v-if="stepCount" class="thinking-process__count">{{ stepCount }} 项操作</span>
      <span v-if="elapsedLabel" class="thinking-process__elapsed"><Clock3 :size="12" aria-hidden="true" />{{ elapsedLabel }}</span>
      <ChevronDown :size="15" class="thinking-process__chevron" :class="{ 'is-expanded': expanded }" aria-hidden="true" />
    </button>
    <div v-else class="thinking-process__simple" :class="`is-${headerTone}`" role="status" aria-live="polite" aria-atomic="true">
      <LoaderCircle v-if="running" :size="14" class="thinking-process__spinner" aria-hidden="true" />
      <CircleStop v-else-if="interrupted" :size="14" aria-hidden="true" />
      <span>{{ headerStatus }}</span>
      <span v-if="elapsedLabel" class="thinking-process__elapsed">{{ elapsedLabel }}</span>
    </div>
    <div v-if="rows.length" :id="panelId" class="thinking-process__body" :hidden="!expanded">
      <p v-if="legacyOrder" class="thinking-process__legacy">历史记录未保存发生顺序，以下为已记录的内容。</p>
      <ol v-if="rows.length" class="thinking-process__timeline" aria-label="思考与执行时间线">
        <li v-for="row in rows" :key="`${row.type}:${row.id}`" :data-process-type="row.type" :data-process-id="row.id"
          :data-agent="row.type === 'agent' ? row.id : undefined" :data-call-id="row.type === 'tool' ? row.id : undefined"
          :data-status="row.type !== 'reasoning' ? row.status : undefined"
          :class="[`thinking-process__row--${row.type}`, row.type !== 'reasoning' ? `is-${row.status}` : '']">
          <template v-if="row.type === 'reasoning'">
            <span class="thinking-process__step-icon thinking-process__step-icon--reasoning"><MessageSquareText :size="16" aria-hidden="true" /></span>
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
              <component :is="stepIcon(row.type, row.id)" :size="16" aria-hidden="true" />
              <span class="thinking-process__icon-badge" :class="`is-${row.status}`">
                <LoaderCircle v-if="row.status === 'running'" :size="11" class="thinking-process__spinner" aria-hidden="true" />
                <Check v-else-if="row.status === 'completed'" :size="10" :stroke-width="3" aria-hidden="true" />
                <CircleAlert v-else-if="row.status === 'failed'" :size="11" aria-hidden="true" />
                <CirclePause v-else-if="row.status === 'awaiting_confirmation'" :size="11" aria-hidden="true" />
                <CircleHelp v-else-if="row.status === 'needs_clarification'" :size="11" aria-hidden="true" />
                <CircleStop v-else-if="row.status === 'interrupted'" :size="11" aria-hidden="true" />
                <CircleMinus v-else :size="11" aria-hidden="true" />
              </span>
            </span>
            <div class="thinking-process__step-copy">
              <details v-if="row.type === 'tool'" class="thinking-process__tool-details">
                <summary class="thinking-process__step-heading">
                  <span class="thinking-process__step-name">{{ row.title }}</span><span class="thinking-process__step-status" :class="`is-${row.status}`">{{ row.statusLabel }}</span>
                  <span v-if="row.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(row.durationMs) }}</span><ChevronDown :size="12" aria-hidden="true" />
                </summary>
                <p class="thinking-process__tool-id">工具：<code>{{ row.tool }}</code></p>
              </details>
              <div v-else class="thinking-process__step-heading">
                <span class="thinking-process__step-name">{{ row.title }}</span><span class="thinking-process__step-status" :class="`is-${row.status}`">{{ row.statusLabel }}</span>
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
      <details v-if="internalRows.length" class="thinking-process__internal" data-testid="chat-processing-details">
        <summary>处理详情<ChevronDown :size="12" aria-hidden="true" /></summary>
        <ol class="thinking-process__internal-list" aria-label="内部处理阶段">
          <li v-for="row in internalRows" :key="row.id" :data-internal-agent="row.id" :data-status="row.status">
            <span class="thinking-process__step-icon" :class="`is-${row.status}`">
              <component :is="stepIcon(row.type, row.id)" :size="16" aria-hidden="true" />
              <span class="thinking-process__icon-badge" :class="`is-${row.status}`">
                <LoaderCircle v-if="row.status === 'running'" :size="11" class="thinking-process__spinner" aria-hidden="true" />
                <Check v-else-if="row.status === 'completed'" :size="10" :stroke-width="3" aria-hidden="true" />
                <CircleAlert v-else-if="row.status === 'failed'" :size="11" aria-hidden="true" />
                <CircleStop v-else-if="row.status === 'interrupted'" :size="11" aria-hidden="true" />
                <CircleMinus v-else :size="11" aria-hidden="true" />
              </span>
            </span>
            <div class="thinking-process__step-copy">
              <div class="thinking-process__step-heading">
                <span class="thinking-process__step-name">{{ row.title }}</span>
                <span class="thinking-process__step-status" :class="`is-${row.status}`">{{ row.statusLabel }}</span>
                <span v-if="row.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(row.durationMs) }}</span>
              </div>
              <p v-if="row.detail" class="thinking-process__step-detail">{{ row.detail }}</p>
            </div>
          </li>
        </ol>
      </details>
    </div>
  </section>
</template>

<style scoped>
.thinking-process { --process-primary: var(--primary); --process-success: var(--success-strong); --process-warning: var(--lyle-color-amber-700); --process-danger: var(--danger-strong); width: 100%; min-width: 0; margin: 0 0 18px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--muted-foreground); font-size: 13px; overflow: hidden; }
:global(.dark .thinking-process) { --process-primary: var(--lyle-color-indigo-300); --process-success: var(--lyle-color-emerald-200); --process-warning: var(--lyle-color-amber-200); --process-danger: var(--lyle-color-rose-200); }
.thinking-process.is-active { border-color: var(--primary-border); }
.thinking-process__toggle { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; width: 100%; min-height: 60px; padding: 12px 16px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; line-height: 1.6; }
.thinking-process__toggle:hover { background: color-mix(in srgb, var(--surface-muted) 45%, var(--surface)); }
.thinking-process__toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: -3px; border-radius: 12px; }
.thinking-process__tool-details summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 3px; }
.thinking-process__mark { display: flex; align-items: center; justify-content: center; flex: 0 0 32px; height: 32px; margin-right: 2px; border-radius: 10px; color: var(--process-primary); background: var(--primary-soft); }
.thinking-process__mark.is-interrupted { color: var(--process-warning); background: var(--warning-soft); }
.thinking-process__title { color: var(--foreground); font-weight: 600; }
.thinking-process__status { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; padding: 2px 7px; border-radius: 6px; background: var(--surface-muted); overflow-wrap: anywhere; font-size: 11px; line-height: 1.6; }
.thinking-process__status.is-running { color: var(--process-primary); background: var(--primary-soft); }
.thinking-process__status.is-completed { color: var(--process-success); background: var(--success-soft); }
.thinking-process__status.is-waiting, .thinking-process__status.is-interrupted { color: var(--process-warning); background: var(--warning-soft); }
.thinking-process__count { font-size: 11px; white-space: nowrap; }
.thinking-process__elapsed { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; white-space: nowrap; font-size: 11px; font-variant-numeric: tabular-nums; }
.thinking-process__chevron { flex-shrink: 0; margin-left: auto; transition: transform 160ms ease; }
.thinking-process__elapsed + .thinking-process__chevron { margin-left: 2px; }
.thinking-process__chevron.is-expanded { transform: rotate(180deg); }
.thinking-process__body { border-top: 1px solid var(--border); padding: 16px 20px 4px; }
.thinking-process__body[hidden] { display: none; }
.thinking-process__legacy { margin: 0 0 14px; color: var(--muted-foreground); font-size: 11px; line-height: 1.7; }
.thinking-process__timeline { margin: 0; padding: 0 0 0 14px; list-style: none; }
.thinking-process__timeline > li { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 0 0 20px; border-left: 1px solid var(--border); }
.thinking-process__timeline > li:last-child { padding-bottom: 12px; border-color: transparent; }
.thinking-process__step-icon { position: relative; display: flex; align-items: center; justify-content: center; flex: 0 0 30px; height: 30px; margin-left: -15.5px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted-foreground); background: var(--surface-muted); }
.thinking-process__step-icon.is-completed { color: var(--process-primary); border-color: var(--primary-border); background: var(--primary-soft); }
.thinking-process__step-icon.is-running { color: var(--process-primary); border-color: var(--primary-border); background: var(--primary-soft); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-soft) 70%, transparent); }
.thinking-process__icon-badge { position: absolute; right: -4px; bottom: -4px; display: flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 2px solid var(--surface); border-radius: 50%; }
.thinking-process__icon-badge.is-completed { color: var(--process-success); background: var(--success-soft); }
.thinking-process__icon-badge.is-running { color: var(--process-primary); background: var(--surface); }
.thinking-process__step-icon.is-failed { color: var(--process-danger); border-color: var(--danger-border); background: var(--danger-soft); }
.thinking-process__step-icon.is-interrupted, .thinking-process__step-icon.is-awaiting_confirmation, .thinking-process__step-icon.is-needs_clarification { color: var(--process-warning); border-color: var(--warning-border); background: var(--warning-soft); }
.thinking-process__step-copy { flex: 1; min-width: 0; padding-top: 3px; }
.thinking-process__step-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; line-height: 1.7; }
.thinking-process__step-name { color: var(--foreground); font-weight: 500; overflow-wrap: anywhere; }
.thinking-process__step-status { font-size: 11px; }
.thinking-process__step-status.is-completed { color: var(--process-success); }
.thinking-process__step-status.is-running { color: var(--process-primary); }
.thinking-process__step-status.is-failed { color: var(--process-danger); }
.thinking-process__step-status.is-interrupted, .thinking-process__step-status.is-awaiting_confirmation, .thinking-process__step-status.is-needs_clarification { color: var(--process-warning); }
.thinking-process__step-duration { margin-left: auto; white-space: nowrap; font-size: 11px; font-variant-numeric: tabular-nums; }
.thinking-process__step-detail { margin: 4px 0 0; font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__row--agent.is-running .thinking-process__step-detail, .thinking-process__row--tool.is-running .thinking-process__step-detail { color: var(--process-primary); }
.thinking-process__reasoning-label { color: var(--foreground); font-weight: 500; font-size: 12px; }
.thinking-process__reasoning-text { margin: 5px 0 0; font-size: 12px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__reasoning-text strong { color: var(--foreground); font-weight: 600; }
.thinking-process__reasoning-text code { border-radius: 3px; padding: 1px 4px; background: var(--surface-muted); font-size: .94em; }
.thinking-process__tool-details summary { cursor: pointer; list-style: none; }
.thinking-process__tool-details summary::-webkit-details-marker { display: none; }
.thinking-process__tool-details summary > svg { flex-shrink: 0; align-self: center; transition: transform 160ms ease; }
.thinking-process__tool-details[open] summary > svg { transform: rotate(180deg); }
.thinking-process__tool-id { margin: 6px 0 0; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.thinking-process__empty { margin: 0 0 12px; font-size: 12px; line-height: 1.75; }
.thinking-process__spinner { flex-shrink: 0; animation: thinking-process-spin 1.2s linear infinite; }
@keyframes thinking-process-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  .thinking-process__toggle { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 15px; gap: 4px 6px; padding: 10px 12px; }
  .thinking-process__mark { grid-column: 1; grid-row: 1 / 3; height: 28px; border-radius: 8px; }
  .thinking-process__title { grid-column: 2; grid-row: 1; font-size: 12px; }
  .thinking-process__status { grid-column: 2 / -1; grid-row: 2; justify-self: start; max-width: 100%; }
  .thinking-process__count { display: none; }
  .thinking-process__elapsed { grid-column: 3; grid-row: 1; margin-left: 0; font-size: 10px; }
  .thinking-process__chevron, .thinking-process__elapsed + .thinking-process__chevron { grid-column: 4; grid-row: 1; margin-left: 0; }
  .thinking-process__body { padding: 14px 16px 2px; }
  .thinking-process__timeline > li { gap: 10px; padding-bottom: 18px; }
  .thinking-process__step-heading { gap: 3px 6px; }
  .thinking-process__step-duration { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) { .thinking-process__spinner { animation: none; } .thinking-process__chevron, .thinking-process__tool-details summary > svg { transition: none; } }

.thinking-process.is-simple { border: 0; background: transparent; border-radius: 0; margin-bottom: 10px; overflow: visible; }
.thinking-process__simple { display: flex; align-items: center; gap: 7px; min-height: 36px; padding: 6px 8px; line-height: 1.6; }
.thinking-process__simple.is-interrupted { color: var(--process-warning); }
.thinking-process__simple .thinking-process__elapsed { margin-left: auto; }
.thinking-process__status.is-failed { color: var(--process-danger); background: var(--danger-soft); }
.thinking-process__mark.is-failed { color: var(--process-danger); background: var(--danger-soft); }
.thinking-process__step-icon--reasoning { color: var(--process-primary); border-color: var(--primary-border); background: var(--primary-soft); }
.thinking-process__icon-badge.is-failed { color: var(--process-danger); background: var(--danger-soft); }
.thinking-process__icon-badge.is-interrupted, .thinking-process__icon-badge.is-awaiting_confirmation, .thinking-process__icon-badge.is-needs_clarification { color: var(--process-warning); background: var(--warning-soft); }
.thinking-process__icon-badge.is-ended, .thinking-process__icon-badge.is-skipped { background: var(--surface-muted); }
.thinking-process__output { margin-top: 4px; min-width: 0; }
.thinking-process__output > summary { display: flex; align-items: center; gap: 4px; width: fit-content; max-width: 100%; border-radius: 3px; font-size: 11px; line-height: 1.8; cursor: pointer; list-style: none; }
.thinking-process__output > summary::-webkit-details-marker { display: none; }
.thinking-process__output > summary:hover { color: var(--foreground); }
.thinking-process__output > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.thinking-process__output > summary > svg { flex-shrink: 0; align-self: center; transition: transform 160ms ease; }
.thinking-process__output[open] > summary > svg { transform: rotate(180deg); }
.thinking-process__internal { margin: 2px 0 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.thinking-process__internal > summary { display: flex; align-items: center; gap: 4px; width: fit-content; max-width: 100%; border-radius: 3px; font-size: 12px; line-height: 1.8; cursor: pointer; list-style: none; }
.thinking-process__internal > summary::-webkit-details-marker { display: none; }
.thinking-process__internal > summary:hover { color: var(--foreground); }
.thinking-process__internal > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.thinking-process__internal > summary > svg { transition: transform 160ms ease; }
.thinking-process__internal[open] > summary > svg { transform: rotate(180deg); }
.thinking-process__internal-list { margin: 16px 0 0; padding: 0 0 0 14px; list-style: none; }
.thinking-process__internal-list > li { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 0 0 20px; border-left: 1px solid var(--border); }
.thinking-process__internal-list > li:last-child { padding-bottom: 0; border-color: transparent; }
@media (max-width: 600px) { .thinking-process__internal-list > li { gap: 10px; padding-bottom: 18px; } }
@media (prefers-reduced-motion: reduce) { .thinking-process__output > summary > svg, .thinking-process__internal > summary > svg { transition: none; } }
</style>
