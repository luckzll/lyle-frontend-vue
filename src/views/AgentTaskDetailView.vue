<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CircleStop, Pause, Play, Radio, RefreshCw } from '@lucide/vue'
import { cancelAgentTask, getAgentTask, pauseAgentTask, provideAgentTaskInput, resumeAgentTask, startAgentTask, type AgentArtifact, type AgentInputAction, type AgentTask } from '@/api/agentTasks'
import { useAgentTaskEvents } from '@/composables/useAgentTaskEvents'
import AgentBudgetMeter from '@/components/domain/agent/AgentBudgetMeter.vue'
import AgentStepTimeline from '@/components/domain/agent/AgentStepTimeline.vue'
import ChangePreviewCard from '@/components/domain/agent/ChangePreviewCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import { toAppError } from '@/api/errors'
import { safeAgentArtifactSummary } from '@/features/agentOutput'

const route = useRoute()
const router = useRouter()
const task = ref<AgentTask | null>(null)
const loading = ref(true)
const action = ref('')
const error = ref('')
const input = ref('')
const inputAction = ref<AgentInputAction>('RETRY')
const cancelOpen = ref(false)
const taskId = computed(() => String(route.params.id || ''))
const resultArtifact = computed<AgentArtifact | undefined>(() => [...(task.value?.artifacts || [])].reverse().find((item) => item.type === 'RESULT'))
const progress = computed(() => {
  const total = task.value?.plan?.steps.length || 0
  return total ? Math.min(100, Math.round((task.value?.run?.budgetUsed.completedSteps || 0) / total * 100)) : 0
})
const elapsed = computed(() => {
  const start = task.value?.run?.startedAt
  if (!start) return '尚未开始'
  const end = task.value?.run?.finishedAt ? new Date(task.value.run.finishedAt).getTime() : Date.now()
  const minutes = Math.max(0, Math.round((end - new Date(start).getTime()) / 60000))
  return `${minutes} 分钟`
})

const { connected, connect } = useAgentTaskEvents(async () => { await load(false) })
onMounted(async () => { await load(); if (task.value && !isTerminal(task.value.status)) connect(taskId.value) })

async function load(showLoading = true) {
  if (showLoading) loading.value = true
  error.value = ''
  try { task.value = (await getAgentTask(taskId.value)).data }
  catch (exception) { error.value = toAppError(exception, '任务详情加载失败。').message }
  finally { if (showLoading) loading.value = false }
}

async function runAction(name: string, fn: (current: AgentTask) => Promise<{ data: AgentTask }>) {
  if (!task.value || action.value) return
  action.value = name
  error.value = ''
  try { task.value = (await fn(task.value)).data }
  catch (exception) { error.value = toAppError(exception, '任务操作失败，请刷新后重试。').message }
  finally { action.value = '' }
}
function start() { return runAction('start', (current) => startAgentTask(current.id, current.version)) }
function pause() { return runAction('pause', (current) => pauseAgentTask(current.id, current.version)) }
function resume() { return runAction('resume', (current) => resumeAgentTask(current.id, current.version)) }
async function submitInput() {
  const value = input.value.trim()
  if (!value) return
  await runAction('input', (current) => provideAgentTaskInput(current.id, current.version, value, inputAction.value))
  if (!error.value) input.value = ''
  if (task.value?.status === 'AWAITING_PLAN_APPROVAL') await router.push(`/agent-tasks/${task.value.id}/plan`)
}
async function cancel() { cancelOpen.value = false; await runAction('cancel', (current) => cancelAgentTask(current.id, current.version)) }
function openConfirmation(operationId: number) { void router.push({ path: '/execution-center', query: { view: 'confirmations', operationId: String(operationId), agentTaskId: String(taskId.value) } }) }
function isTerminal(status: string) { return ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(status) }
function detailText(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value) }
</script>

<template>
  <div class="page detail-page">
    <LoadingState v-if="loading" label="正在加载任务运行台" :cards="3" />
    <ErrorState v-else-if="error && !task" title="任务加载失败" :message="error" @retry="load" />
    <template v-else-if="task">
      <RouterLink class="back" to="/agent-tasks"><ArrowLeft :size="16" />返回 Agent Task</RouterLink>
      <header class="task-header">
        <div class="task-title"><div class="status-line"><StatusBadge :status="task.status" /><span v-if="connected" class="live"><Radio :size="12" />实时更新</span></div><h1>{{ task.title }}</h1><p>{{ task.goal }}</p></div>
        <div class="controls">
          <AppButton v-if="task.availableActions?.includes('START')" :loading="action === 'start'" @click="start"><Play :size="16" />开始</AppButton>
          <AppButton v-if="task.availableActions?.includes('PAUSE')" variant="secondary" :loading="action === 'pause'" @click="pause"><Pause :size="16" />暂停</AppButton>
          <AppButton v-if="task.availableActions?.includes('RESUME')" :loading="action === 'resume'" @click="resume"><Play :size="16" />{{ task.status === 'AWAITING_CONFIRMATION' ? '已处理，继续' : '继续' }}</AppButton>
          <AppButton variant="secondary" size="icon" aria-label="刷新" :loading="action === 'refresh'" @click="load(false)"><RefreshCw :size="16" /></AppButton>
        </div>
      </header>

      <div class="summary-strip"><div><span>进度</span><strong>{{ progress }}%</strong></div><div><span>耗时</span><strong>{{ elapsed }}</strong></div><div><span>计划</span><strong>v{{ task.activePlanVersion || '—' }}</strong></div><div><span>权限</span><strong>Level {{ task.autonomyLevel }}</strong></div></div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <ChangePreviewCard v-if="task.pendingChangePreview" :preview="task.pendingChangePreview" @open-confirmation="openConfirmation" />
      <AppCard v-if="task.status === 'AWAITING_INPUT'" class="input-card"><div><h2>需要你选择后续路径</h2><p>你的说明会完整保存，并传给下一次决策或修订后的计划。</p></div><div class="input-fields"><select v-model="inputAction" aria-label="后续动作"><option value="RETRY">修复后继续</option><option value="SKIP">跳过当前步骤</option><option value="REVISE_PLAN">调整计划并重新审批</option><option value="TERMINATE">终止并保留结果</option></select><textarea v-model="input" rows="3" placeholder="说明修复结果、要跳过的内容或新的执行要求。" /></div><AppButton :loading="action === 'input'" :disabled="!input.trim()" @click="submitInput">提交选择</AppButton></AppCard>

      <div class="workspace">
        <main>
          <AppCard><div class="section-heading"><div><span class="eyebrow">运行时间线</span><h2>执行步骤</h2></div><span>{{ task.run?.budgetUsed.completedSteps || 0 }} / {{ task.plan?.steps.length || 0 }}</span></div><AgentStepTimeline v-if="task.plan" :steps="task.plan.steps" :runs="task.stepRuns" /></AppCard>
          <AppCard v-if="resultArtifact" class="result-card"><div class="section-heading"><div><span class="eyebrow">最终结果</span><h2>{{ resultArtifact.title }}</h2></div><StatusBadge :status="task.status" /></div><p class="result-summary">{{ resultArtifact.summary }}</p><section v-if="Array.isArray(resultArtifact.metadata.criteria)"><h3>完成标准</h3><ul><li v-for="criterion in resultArtifact.metadata.criteria as any[]" :key="detailText(criterion.criterion)"><span>{{ criterion.status }}</span><p>{{ criterion.criterion }} · {{ criterion.note }}</p></li></ul></section><section v-if="Array.isArray(resultArtifact.metadata.gaps) && resultArtifact.metadata.gaps.length"><h3>未完成</h3><ul><li v-for="gap in resultArtifact.metadata.gaps as unknown[]" :key="detailText(gap)">{{ detailText(gap) }}</li></ul></section></AppCard>
          <AppCard v-else-if="task.artifacts?.length"><div class="section-heading"><div><span class="eyebrow">当前产物</span><h2>证据与结果</h2></div><span>{{ task.artifacts.length }} 项</span></div><div class="artifact-list"><article v-for="artifact in task.artifacts" :key="artifact.id"><header><strong>{{ artifact.title }}</strong><span>{{ artifact.type }}</span></header><p>{{ safeAgentArtifactSummary(artifact) }}</p><small>{{ artifact.contentRef || `artifact #${artifact.id}` }}</small></article></div></AppCard>
        </main>
        <aside>
          <AppCard v-if="task.run"><AgentBudgetMeter :limit="task.run.budgetLimit" :used="task.run.budgetUsed" /></AppCard>
          <AppCard v-if="task.plan" class="details"><h2>计划与权限</h2><dl><div><dt>批准状态</dt><dd>{{ task.plan.approvalStatus }}</dd></div><div><dt>外部网络</dt><dd>{{ task.plan.accessScope.network || 'NONE' }}</dd></div><div><dt>允许工具</dt><dd>{{ (task.plan.accessScope.allowedTools as string[] || []).join('、') }}</dd></div><div><dt>连续无进展</dt><dd>{{ task.run?.noProgressCount || 0 }} / {{ task.plan.budget.maxConsecutiveNoProgress }}</dd></div></dl><details><summary>技术详情</summary><code>task {{ task.id }} · run {{ task.currentRunId || '—' }}</code></details></AppCard>
          <AppCard v-if="!isTerminal(task.status)" class="danger-zone"><h2>终止任务</h2><p>保留已完成步骤和证据，不再启动新的工具调用。</p><AppButton variant="ghost" @click="cancelOpen = true"><CircleStop :size="16" />终止</AppButton></AppCard>
        </aside>
      </div>
      <ConfirmActionDialog :open="cancelOpen" title="终止这个 Agent Task？" description="当前部分结果会保留，终止后不能原地继续；再次运行将创建新的 Run。" confirm-label="终止任务" danger :busy="action === 'cancel'" @update:open="cancelOpen = $event" @confirm="cancel" />
    </template>
  </div>
</template>

<style scoped>
.detail-page { width: min(1280px, 100%); margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.task-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }.task-title { min-width: 0; }.status-line { display: flex; align-items: center; gap: var(--space-2); }.live { display: inline-flex; align-items: center; gap: 4px; color: var(--success-strong); font-size: 11px; font-weight: 700; }
h1 { margin: var(--space-3) 0 6px; font-size: clamp(25px, 4vw, 34px); letter-spacing: -.03em; }.task-title > p { max-width: 780px; margin: 0; color: var(--muted-foreground); line-height: 1.6; }.controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); }.summary-strip div { display: grid; gap: 4px; padding: var(--space-3) var(--space-4); }.summary-strip div:not(:last-child) { border-right: 1px solid var(--border); }.summary-strip span { color: var(--muted-foreground); font-size: 11px; }.summary-strip strong { font-size: 16px; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; gap: var(--space-4); }.workspace main, .workspace aside { display: grid; min-width: 0; gap: var(--space-4); }.workspace aside { position: sticky; top: calc(var(--lyle-header-height) + var(--space-4)); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-5); }.eyebrow { color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }h2 { margin: 4px 0 0; font-size: 17px; }.section-heading > span { color: var(--muted-foreground); font-size: 12px; }
.input-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 1fr) auto; align-items: end; gap: var(--space-3); border-color: var(--warning-border); background: var(--warning-soft); }.input-card h2 { margin: 0 0 4px; }.input-card p { margin: 0; color: var(--warning-strong); font-size: 13px; }.input-fields { display: grid; gap: var(--space-2); }.input-card textarea, .input-card select { width: 100%; border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--surface); padding: 9px 11px; color: var(--foreground); font: inherit; }.input-card textarea { resize: vertical; }
.artifact-list { display: grid; gap: var(--space-3); }.artifact-list article { border-top: 1px solid var(--border); padding-top: var(--space-3); }.artifact-list article header { display: flex; justify-content: space-between; gap: var(--space-2); }.artifact-list header span, .artifact-list small { color: var(--muted-foreground); font-size: 11px; }.artifact-list p { margin: 6px 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.55; }
.result-summary { margin: 0; font-size: 16px; line-height: 1.7; }.result-card section { margin-top: var(--space-5); }.result-card h3 { margin: 0 0 var(--space-2); font-size: 13px; }.result-card ul { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }.result-card li { display: flex; align-items: flex-start; gap: var(--space-2); }.result-card li span { border-radius: 999px; background: var(--success-soft); padding: 3px 7px; color: var(--success-strong); font-size: 10px; font-weight: 750; }.result-card li p { margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
.details dl { display: grid; gap: var(--space-3); margin: var(--space-4) 0 0; }.details dl div { display: grid; gap: 3px; }.details dt { color: var(--muted-foreground); font-size: 11px; }.details dd { margin: 0; font-size: 12px; overflow-wrap: anywhere; }.details details { margin-top: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-3); }.details summary { color: var(--muted-foreground); font-size: 12px; cursor: pointer; }.details code { display: block; margin-top: var(--space-2); overflow-wrap: anywhere; font-size: 11px; }
.danger-zone { display: grid; gap: var(--space-2); }.danger-zone h2 { margin: 0; }.danger-zone p { margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }.danger-zone :deep(button) { justify-self: start; color: var(--danger-strong); }.error { margin: 0; color: var(--danger-strong); font-size: 13px; }
@media (max-width: 900px) { .workspace { grid-template-columns: 1fr; }.workspace aside { position: static; grid-row: 1; grid-template-columns: 1fr 1fr; }.danger-zone { display: none; } }
@media (max-width: 700px) { .task-header { flex-direction: column; }.controls { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; justify-content: flex-end; border-top: 1px solid var(--border); background: var(--surface); padding: var(--space-3); }.summary-strip { grid-template-columns: 1fr 1fr; }.summary-strip div:nth-child(2) { border-right: 0; }.summary-strip div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }.workspace aside { grid-template-columns: 1fr; }.input-card { grid-template-columns: 1fr; } }
</style>
