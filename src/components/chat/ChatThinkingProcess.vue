<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown, CircleAlert, CircleMinus, CircleStop, LoaderCircle } from '@lucide/vue'
import { AGENT_STEPS, type AgentStepEvent } from '@/domain/chat-progress'
import type { ChatReasoning } from '@/domain/chat-reasoning'
import { formatTraceDuration } from '@/domain/chat-trace-presentation'

const props = defineProps<{
  items: AgentStepEvent[]
  reasoning?: ChatReasoning
  phase?: string
  active?: boolean
  statusText?: string
  startedAt?: number
  completedAt?: number
}>()

const panelId = `thinking-process-${useId()}`
const interrupted = computed(() => ['FAILED', 'CANCELLED', 'CANCELED'].includes(props.phase || ''))
const completed = computed(() => props.phase === 'COMPLETED')
const running = computed(() => Boolean(props.active) && !interrupted.value && !completed.value)
const expanded = ref(running.value)
const manuallyToggled = ref(false)
const now = ref(Date.now())
const reasoningPanel = ref<HTMLElement>()
const followReasoning = ref(true)
let timer: ReturnType<typeof setInterval> | undefined

const reasoningText = computed(() => props.reasoning?.text.trim() ? props.reasoning.text : '')
const visible = computed(() => running.value || props.items.length > 0 || Boolean(reasoningText.value))
const steps = computed(() => props.items.map(item => {
  const status = item.status === 'running' && !running.value
    ? interrupted.value ? 'interrupted' : 'ended'
    : item.status
  return {
    ...item,
    displayStatus: status,
    label: AGENT_STEPS[item.step],
    statusLabel: { running: '进行中', completed: '已完成', failed: '失败', skipped: '已跳过', interrupted: '已中断', ended: '已结束' }[status],
    detail: status === 'interrupted' ? '本轮已中断，此步骤未完成'
      : status === 'ended' ? '本轮已结束，未收到此步骤的完成状态'
        : item.summary
  }
}))
const headerStatus = computed(() => {
  if (interrupted.value) return '已中断'
  if (completed.value) return '已完成'
  if (!running.value) return '已结束'
  if (props.statusText?.trim()) return props.statusText
  const current = steps.value.filter(item => item.displayStatus === 'running')
  if (current.length) return current.map(item => item.label).join('、')
  return reasoningText.value ? '正在思考' : '正在处理'
})
const elapsedLabel = computed(() => {
  const start = props.startedAt
  const end = props.completedAt ?? (running.value ? now.value : undefined)
  if (typeof start !== 'number' || !Number.isFinite(start) || start <= 0
    || typeof end !== 'number' || !Number.isFinite(end) || end < start) return ''
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `用时 ${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return `用时 ${minutes} 分 ${seconds % 60} 秒`
})

function toggleExpanded() {
  manuallyToggled.value = true
  expanded.value = !expanded.value
}

function trackReasoningScroll() {
  const panel = reasoningPanel.value
  if (panel) followReasoning.value = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40
}

watch(running, (active, previous) => {
  if (active) {
    // A retry can reuse the same component and turn ID. Give the new run its own disclosure state.
    if (!previous) {
      manuallyToggled.value = false
      expanded.value = true
      followReasoning.value = true
    }
  } else if (!manuallyToggled.value) {
    expanded.value = false
  }
}, { immediate: true })

onMounted(() => {
  watch(running, active => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (active) {
      now.value = Date.now()
      timer = setInterval(() => { now.value = Date.now() }, 1000)
    }
  }, { immediate: true })
})

watch([reasoningText, expanded], async () => {
  if (!expanded.value || !running.value || !followReasoning.value) return
  await nextTick()
  const panel = reasoningPanel.value
  if (panel) panel.scrollTop = panel.scrollHeight
}, { flush: 'post' })

onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section v-if="visible" class="thinking-process" :class="{ 'is-active': running }" aria-label="思考与执行过程" data-testid="chat-thinking-process">
    <button
      type="button"
      class="thinking-process__toggle"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      @click="toggleExpanded"
    >
      <LoaderCircle v-if="running" :size="15" class="thinking-process__spinner" aria-hidden="true" />
      <CircleStop v-else-if="interrupted" :size="15" aria-hidden="true" />
      <span class="thinking-process__title">思考与执行过程</span>
      <span class="thinking-process__status" role="status" aria-live="polite" aria-atomic="true">{{ headerStatus }}</span>
      <span v-if="elapsedLabel" class="thinking-process__elapsed">{{ elapsedLabel }}</span>
      <ChevronDown :size="14" class="thinking-process__chevron" :class="{ 'is-expanded': expanded }" aria-hidden="true" />
    </button>

    <div :id="panelId" class="thinking-process__body" :hidden="!expanded">
      <div v-if="reasoningText" class="thinking-process__reasoning">
        <p class="thinking-process__label">{{ reasoning?.kind === 'summary' ? '思考摘要' : '模型思考' }}</p>
        <div
          ref="reasoningPanel"
          class="thinking-process__reasoning-text"
          tabindex="0"
          role="region"
          :aria-label="reasoning?.kind === 'summary' ? '思考摘要内容' : '模型思考内容'"
          @scroll="trackReasoningScroll"
        >{{ reasoningText }}</div>
      </div>

      <ol v-if="steps.length" class="thinking-process__steps" aria-label="执行步骤">
        <li v-for="item in steps" :key="item.step" :data-agent="item.step" :data-status="item.displayStatus">
          <span class="thinking-process__step-icon" :class="`is-${item.displayStatus}`">
            <LoaderCircle v-if="item.displayStatus === 'running'" :size="14" class="thinking-process__spinner" aria-hidden="true" />
            <Check v-else-if="item.displayStatus === 'completed'" :size="14" aria-hidden="true" />
            <CircleAlert v-else-if="item.displayStatus === 'failed'" :size="14" aria-hidden="true" />
            <CircleStop v-else-if="item.displayStatus === 'interrupted'" :size="14" aria-hidden="true" />
            <CircleMinus v-else :size="14" aria-hidden="true" />
          </span>
          <div class="thinking-process__step-copy">
            <div class="thinking-process__step-heading">
              <span class="thinking-process__step-name">{{ item.label }}</span>
              <span class="thinking-process__step-status">{{ item.statusLabel }}</span>
              <span v-if="item.durationMs !== undefined" class="thinking-process__step-duration">{{ formatTraceDuration(item.durationMs) }}</span>
            </div>
            <p v-if="item.detail" class="thinking-process__step-detail">{{ item.detail }}</p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.thinking-process { width: 100%; min-width: 0; margin: 0 0 16px; color: var(--muted-foreground); font-size: 13px; }
.thinking-process__toggle { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 9px; width: 100%; min-height: 38px; padding: 4px 0; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; line-height: 1.6; }
.thinking-process__toggle:hover { color: var(--foreground); }
.thinking-process__toggle:focus-visible, .thinking-process__reasoning-text:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.thinking-process__toggle > svg { flex-shrink: 0; }
.thinking-process__title { font-weight: 500; }
.thinking-process__status { min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
.thinking-process__status::before { content: '·'; margin-right: 9px; }
.thinking-process__elapsed { margin-left: auto; white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.thinking-process__chevron { transition: transform 160ms ease; }
.thinking-process__chevron.is-expanded { transform: rotate(180deg); }
.thinking-process__body { border-top: 1px solid var(--border); padding: 14px 0 4px; }
.thinking-process__body[hidden] { display: none; }
.thinking-process__reasoning { margin-bottom: 17px; }
.thinking-process__reasoning:last-child { margin-bottom: 2px; }
.thinking-process__label { margin: 0 0 7px; font-size: 11px; font-weight: 500; }
.thinking-process__reasoning-text { max-height: 280px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding-right: 8px; color: var(--muted-foreground); line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__steps { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.thinking-process__steps li { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.thinking-process__step-icon { display: flex; flex: 0 0 16px; justify-content: center; padding-top: 4px; }
.thinking-process__step-icon.is-failed { color: var(--danger-strong); }
.thinking-process__step-icon.is-interrupted { color: var(--warning-strong); }
.thinking-process__step-copy { flex: 1; min-width: 0; }
.thinking-process__step-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; line-height: 1.7; }
.thinking-process__step-name { overflow-wrap: anywhere; }
.thinking-process__step-status, .thinking-process__step-duration { font-size: 11px; }
.thinking-process__step-duration { margin-left: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.thinking-process__step-detail { margin: 3px 0 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.thinking-process__spinner { animation: thinking-process-spin 1.2s linear infinite; }
@keyframes thinking-process-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  .thinking-process__toggle { gap: 5px 7px; }
  .thinking-process__status { flex-basis: calc(100% - 24px); order: 4; margin-left: 24px; }
  .thinking-process__status::before { content: none; }
  .thinking-process__reasoning-text { max-height: 220px; }
}
@media (prefers-reduced-motion: reduce) {
  .thinking-process__spinner { animation: none; }
  .thinking-process__chevron { transition: none; }
}
</style>
