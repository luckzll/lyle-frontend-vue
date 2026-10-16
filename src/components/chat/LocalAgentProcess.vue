<script setup lang="ts">
import { computed, useId } from 'vue'
import { BrainCircuit, Check, ChevronDown, CircleAlert, CircleMinus, CirclePause, CircleStop,
  FilePlus2, FileSearch, FolderSearch, LoaderCircle, PenLine, Search, Workflow } from '@lucide/vue'
import LocalProjectText from './LocalProjectText.vue'
import { localActivityDisplayStatus, localActivityFeedback } from '@/domain/local-agent-process'
import type { LocalActivity } from '@/domain/local-workspace-history'

const props = defineProps<{ activities: LocalActivity[]; open: boolean; completed?: boolean; active?: boolean; waiting?: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const panelId = `local-agent-process-${useId()}`
const running = computed(() => Boolean(props.active) && !props.completed)
const awaiting = computed(() => running.value && (props.waiting || props.activities.some(activity => activity.status === 'waiting')))
const tone = computed(() => props.completed ? rows.value.some(row => ['error', 'interrupted', 'rejected'].includes(row.status)) ? 'ended' : 'completed'
  : awaiting.value ? 'waiting' : running.value ? 'running' : 'interrupted')
const statusLabel = computed(() => ({ completed: '已完成', ended: '已结束', waiting: '待确认', running: '进行中', interrupted: '已停止' }[tone.value]))
const activityIcons = { '分析下一步': BrainCircuit, '查看目录': FolderSearch, '读取文件': FileSearch,
  '搜索项目': Search, '修改文件': PenLine, '新建文件': FilePlus2 }
const rowStatusLabels = { running: '进行中', done: '已完成', error: '未完成', waiting: '待确认', interrupted: '已停止', rejected: '未执行' }
const rows = computed(() => props.activities.map((activity, index) => {
  const status = localActivityDisplayStatus(activity, running.value)
  const detail = localActivityFeedback(activity, status)
  const discloseDetail = detail.length > 280 || detail.split('\n').length > 5
  const needsNotice = ['error', 'waiting', 'interrupted', 'rejected'].includes(status)
  return { ...activity, id: index, status, statusLabel: rowStatusLabels[status],
    icon: activityIcons[activity.label as keyof typeof activityIcons] || Workflow,
    detail,
    showFeedback: Boolean(activity.detail?.trim()) || status !== 'done',
    discloseDetail,
    notice: discloseDetail && needsNotice ? localActivityFeedback({ ...activity, detail: undefined }, status) : '',
    disclosedDetail: discloseDetail && needsNotice && activity.detail?.trim() ? activity.detail : detail }
}))
const currentOperation = computed(() => {
  if (!running.value) return null
  const currentRows = rows.value.filter(row => row.status === (awaiting.value ? 'waiting' : 'running'))
  return currentRows[currentRows.length - 1] || null
})
</script>

<template>
  <section v-if="activities.length" class="local-agent-process" :class="{ 'is-active': running, 'is-open': open }" aria-label="项目智能体执行过程" data-testid="local-agent-process">
    <button type="button" class="local-agent-process__toggle" :aria-expanded="open" :aria-controls="panelId" @click="emit('update:open', !open)">
      <span class="local-agent-process__mark" :class="`is-${tone}`">
        <BrainCircuit :size="18" aria-hidden="true" />
      </span>
      <span class="local-agent-process__title">执行过程</span>
      <span class="local-agent-process__status" :class="`is-${tone}`" role="status" aria-live="polite" aria-atomic="true">
        <LoaderCircle v-if="tone === 'running'" :size="12" class="local-agent-process__spinner" aria-hidden="true" />
        <Check v-else-if="tone === 'completed'" :size="12" aria-hidden="true" />
        <CirclePause v-else-if="tone === 'waiting'" :size="12" aria-hidden="true" />
        <CircleAlert v-else-if="tone === 'ended'" :size="12" aria-hidden="true" />
        <CircleStop v-else-if="tone === 'interrupted'" :size="12" aria-hidden="true" />
        {{ statusLabel }}
        <span v-if="currentOperation" class="local-agent-process__current-operation">· {{ currentOperation.label }}</span>
      </span>
      <span class="local-agent-process__count">{{ activities.length }} 个步骤</span>
      <ChevronDown :size="15" class="local-agent-process__chevron" :class="{ 'is-expanded': open }" aria-hidden="true" />
    </button>
    <div :id="panelId" class="local-agent-process__body" :hidden="!open">
      <ol class="local-agent-process__timeline" aria-label="项目执行时间线">
        <li v-for="row in rows" :key="row.id" :data-activity-index="row.id" :data-status="row.status" :class="`is-${row.status}`">
          <span class="local-agent-process__step-icon" :class="`is-${row.status}`">
            <component :is="row.icon" :size="16" aria-hidden="true" />
            <span class="local-agent-process__icon-badge" :class="`is-${row.status}`">
              <LoaderCircle v-if="row.status === 'running'" :size="11" class="local-agent-process__spinner" aria-hidden="true" />
              <Check v-else-if="row.status === 'done'" :size="10" :stroke-width="3" aria-hidden="true" />
              <CircleAlert v-else-if="row.status === 'error'" :size="11" aria-hidden="true" />
              <CirclePause v-else-if="row.status === 'waiting'" :size="11" aria-hidden="true" />
              <CircleStop v-else-if="row.status === 'interrupted'" :size="11" aria-hidden="true" />
              <CircleMinus v-else :size="11" aria-hidden="true" />
            </span>
          </span>
          <div class="local-agent-process__step-copy">
            <div class="local-agent-process__step-heading">
              <span class="local-agent-process__step-name">{{ row.label }}</span>
              <span class="local-agent-process__step-status" :class="`is-${row.status}`">{{ row.statusLabel }}</span>
            </div>
            <code v-if="row.path" class="local-agent-process__path">{{ row.path }}</code>
            <template v-if="row.showFeedback">
              <template v-if="row.discloseDetail">
                <p v-if="row.notice" class="local-agent-process__notice">{{ row.notice }}</p>
                <details class="local-agent-process__output">
                  <summary>查看输出详情<ChevronDown :size="12" aria-hidden="true" /></summary>
                  <LocalProjectText class="local-agent-process__feedback" :text="row.disclosedDetail" />
                </details>
              </template>
              <LocalProjectText v-else class="local-agent-process__feedback" :text="row.detail" />
            </template>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.local-agent-process { --process-primary: var(--primary); --process-success: var(--success-strong); --process-warning: var(--lyle-color-amber-700); --process-danger: var(--danger-strong); width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--muted-foreground); font-size: 13px; overflow: hidden; }
:global(.dark .local-agent-process) { --process-primary: var(--lyle-color-indigo-300); --process-success: var(--lyle-color-emerald-200); --process-warning: var(--lyle-color-amber-200); --process-danger: var(--lyle-color-rose-200); }
.local-agent-process.is-active { border-color: var(--primary-border); }
.local-agent-process__toggle { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; width: 100%; min-height: 60px; padding: 12px 16px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; line-height: 1.6; }
.local-agent-process__toggle:hover { background: color-mix(in srgb, var(--surface-muted) 45%, var(--surface)); }
.local-agent-process__toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: -3px; border-radius: 12px; }
.local-agent-process__mark { display: flex; align-items: center; justify-content: center; flex: 0 0 32px; height: 32px; margin-right: 2px; border-radius: 10px; color: var(--process-primary); background: var(--primary-soft); }
.local-agent-process__mark.is-interrupted, .local-agent-process__mark.is-waiting, .local-agent-process__mark.is-ended { color: var(--process-warning); background: var(--warning-soft); }
.local-agent-process__title { color: var(--foreground); font-weight: 600; }
.local-agent-process__status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 6px; font-size: 11px; line-height: 1.6; color: var(--muted-foreground); background: var(--surface-muted); }
.local-agent-process__status.is-running { color: var(--process-primary); background: var(--primary-soft); }
.local-agent-process__status.is-completed { color: var(--process-success); background: var(--success-soft); }
.local-agent-process__status.is-waiting, .local-agent-process__status.is-interrupted, .local-agent-process__status.is-ended { color: var(--process-warning); background: var(--warning-soft); }
.local-agent-process__count { margin-left: auto; font-size: 11px; white-space: nowrap; }
.local-agent-process__chevron { flex-shrink: 0; margin-left: 2px; transition: transform 160ms ease; }
.local-agent-process__chevron.is-expanded { transform: rotate(180deg); }
.local-agent-process__body { border-top: 1px solid var(--border); padding: 16px 20px 4px; }
.local-agent-process__body[hidden] { display: none; }
.local-agent-process__timeline { margin: 0; padding: 0 0 0 14px; list-style: none; }
.local-agent-process__timeline > li { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 0 0 20px; border-left: 1px solid var(--border); }
.local-agent-process__timeline > li:last-child { padding-bottom: 12px; border-color: transparent; }
.local-agent-process__step-icon { position: relative; display: flex; align-items: center; justify-content: center; flex: 0 0 30px; height: 30px; margin-left: -15.5px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted-foreground); background: var(--surface-muted); }
.local-agent-process__step-icon.is-done, .local-agent-process__step-icon.is-running { color: var(--process-primary); border-color: var(--primary-border); background: var(--primary-soft); }
.local-agent-process__step-icon.is-running { box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-soft) 70%, transparent); }
.local-agent-process__step-icon.is-error { color: var(--process-danger); border-color: var(--danger-border); background: var(--danger-soft); }
.local-agent-process__step-icon.is-interrupted, .local-agent-process__step-icon.is-waiting, .local-agent-process__step-icon.is-rejected { color: var(--process-warning); border-color: var(--warning-border); background: var(--warning-soft); }
.local-agent-process__icon-badge { position: absolute; right: -4px; bottom: -4px; display: flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 2px solid var(--surface); border-radius: 50%; }
.local-agent-process__icon-badge.is-done { color: var(--process-success); background: var(--success-soft); }
.local-agent-process__icon-badge.is-running { color: var(--process-primary); background: var(--surface); }
.local-agent-process__step-copy { flex: 1; min-width: 0; padding-top: 3px; }
.local-agent-process__step-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; line-height: 1.7; }
.local-agent-process__step-name { color: var(--foreground); font-weight: 500; overflow-wrap: anywhere; }
.local-agent-process__step-status { font-size: 11px; white-space: nowrap; }
.local-agent-process__step-status.is-done { color: var(--process-success); }
.local-agent-process__step-status.is-running { color: var(--process-primary); }
.local-agent-process__step-status.is-error { color: var(--process-danger); }
.local-agent-process__step-status.is-interrupted, .local-agent-process__step-status.is-waiting, .local-agent-process__step-status.is-rejected { color: var(--process-warning); }
.local-agent-process__path { display: inline-block; max-width: 100%; margin-top: 5px; padding: 2px 6px; border-radius: 5px; background: var(--surface-muted); color: var(--foreground); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.local-agent-process__feedback { margin: 5px 0 0; font-size: 12px; line-height: 1.75; }
.local-agent-process__feedback :deep(h3) { font-size: 12px; margin: 8px 0 4px; }
.local-agent-process__feedback :deep(pre) { max-height: 240px; margin: 7px 0; border-radius: 8px; padding: 10px; background: var(--surface-muted); }
.local-agent-process__feedback :deep(p code) { background: var(--surface-muted); }
.local-agent-process__timeline > .is-running .local-agent-process__feedback { color: var(--process-primary); }
.local-agent-process__spinner { flex-shrink: 0; animation: local-agent-process-spin 1.2s linear infinite; }
@keyframes local-agent-process-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  .local-agent-process__toggle { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 15px; gap: 4px 6px; padding: 10px 12px; }
  .local-agent-process__mark { grid-column: 1; grid-row: 1 / 3; height: 28px; border-radius: 8px; }
  .local-agent-process__title { grid-column: 2; grid-row: 1; font-size: 12px; }
  .local-agent-process__status { grid-column: 2; grid-row: 2; justify-self: start; }
  .local-agent-process__count { grid-column: 3; grid-row: 1; margin-left: 0; font-size: 10px; }
  .local-agent-process__chevron { grid-column: 4; grid-row: 1; margin-left: 0; }
  .local-agent-process__body { padding: 14px 16px 2px; }
  .local-agent-process__timeline > li { gap: 10px; padding-bottom: 18px; }
}
@media (prefers-reduced-motion: reduce) { .local-agent-process__spinner { animation: none; } .local-agent-process__chevron { transition: none; } }

.local-agent-process__notice { margin: 4px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.75; overflow-wrap: anywhere; }
.local-agent-process__output { margin-top: 4px; min-width: 0; }
.local-agent-process__output > summary { display: flex; align-items: center; gap: 4px; width: fit-content; max-width: 100%; border-radius: 3px; color: var(--muted-foreground); font-size: 11px; line-height: 1.8; cursor: pointer; list-style: none; }
.local-agent-process__output > summary::-webkit-details-marker { display: none; }
.local-agent-process__output > summary:hover { color: var(--foreground); }
.local-agent-process__output > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.local-agent-process__output > summary svg { flex-shrink: 0; transition: transform 160ms ease; }
.local-agent-process__output[open] > summary svg { transform: rotate(180deg); }
.local-agent-process__output .local-agent-process__feedback { padding-top: 2px; }
.local-agent-process__feedback :deep(h1), .local-agent-process__feedback :deep(h2), .local-agent-process__feedback :deep(h3), .local-agent-process__feedback :deep(h4), .local-agent-process__feedback :deep(h5), .local-agent-process__feedback :deep(h6) { font-size: 12px; margin: 10px 0 4px; }
.local-agent-process__feedback :deep(p), .local-agent-process__feedback :deep(ul), .local-agent-process__feedback :deep(ol) { margin-bottom: 6px; }
.local-agent-process__feedback :deep(li) { margin: 2px 0; }
.local-agent-process__feedback :deep(blockquote) { margin: 8px 0; border-left-width: 1px; padding-left: 10px; }
.local-agent-process__feedback :deep(.markdown-code-block), .local-agent-process__feedback :deep(.markdown-table-wrap) { margin: 8px 0; border-radius: 6px; }
.local-agent-process__feedback :deep(.markdown-code-toolbar) { min-height: 30px; padding: 3px 9px; }
.local-agent-process__feedback :deep(pre) { max-height: 200px; margin: 0; border: 0; border-radius: 0; padding: 9px 10px; background: transparent; font-size: 11px; }
.local-agent-process__feedback :deep(th), .local-agent-process__feedback :deep(td) { min-width: 80px; padding: 6px 8px; }
.local-agent-process__feedback :deep(p code) { background: var(--surface-muted); }
.local-agent-process__status { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.local-agent-process__current-operation { color: inherit; }
.local-agent-process__icon-badge.is-error { color: var(--process-danger); background: var(--danger-soft); }
.local-agent-process__icon-badge.is-waiting, .local-agent-process__icon-badge.is-interrupted, .local-agent-process__icon-badge.is-rejected { color: var(--process-warning); background: var(--warning-soft); }
@media (prefers-reduced-motion: reduce) { .local-agent-process__output > summary svg { transition: none; } }
</style>
