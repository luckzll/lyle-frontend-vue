<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  CalendarClock,
  CircleStop,
  Eye,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck
} from '@lucide/vue'
import {
  compensateAgentAction,
  disableMissionTrigger,
  getCompensation,
  getMission,
  pauseMission,
  resumeMission,
  revokeMission,
  runMissionNow,
  updateMissionTrigger,
  type AuthorizationDecision,
  type Compensation,
  type Mission
} from '@/api/missions'
import { toAppError } from '@/api/errors'
import { formatBeijingTime } from '@/domain/date-time'
import MissionStatusBadge from '@/components/domain/mission/MissionStatusBadge.vue'
import PeriodBudgetMeter from '@/components/domain/mission/PeriodBudgetMeter.vue'
import CompensationStatus from '@/components/domain/mission/CompensationStatus.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import { useMissionEvents } from '@/composables/useMissionEvents'

const route = useRoute()
const router = useRouter()
const mission = ref<Mission | null>(null)
const compensations = ref<Record<string, Compensation>>({})
const loading = ref(true)
const action = ref('')
const error = ref('')
const feedback = ref('')
const revokeOpen = ref(false)
const compensationTarget = ref<Compensation | null>(null)
const triggerDrafts = ref<Record<string, {
  frequency: string
  time: string
  dayOfWeek: string
  misfirePolicy: 'SKIP' | 'RUN_ONCE'
}>>({})
const latestGrant = computed(() => mission.value?.grants?.[0])
const availableActions = computed(() => new Set(mission.value?.availableActions || []))
const recentDecisions = computed(() => mission.value?.recentDecisions || [])
let eventRefreshTimer: number | null = null
const { connected: eventStreamConnected, connect: connectMissionEvents } = useMissionEvents(() => {
  if (eventRefreshTimer !== null) window.clearTimeout(eventRefreshTimer)
  eventRefreshTimer = window.setTimeout(() => {
    eventRefreshTimer = null
    void load(false)
  }, 150)
})

onMounted(async () => {
  await load()
  connectMissionEvents(String(route.params.id))
})
onBeforeUnmount(() => {
  if (eventRefreshTimer !== null) window.clearTimeout(eventRefreshTimer)
})

async function load(showLoading = true) {
  if (showLoading) loading.value = true
  error.value = ''
  try {
    mission.value = (await getMission(String(route.params.id))).data
    initializeTriggerDrafts()
    await loadCompensations(mission.value.recentDecisions || [])
  } catch (exception) {
    error.value = toAppError(exception, '持续任务详情加载失败。').message
  } finally {
    if (showLoading) loading.value = false
  }
}

function initializeTriggerDrafts() {
  if (!mission.value) return
  triggerDrafts.value = Object.fromEntries((mission.value.triggers || []).map((trigger) => [
    trigger.id,
    {
      frequency: String(trigger.config.frequency || 'DAILY'),
      time: String(trigger.config.time || '09:00'),
      dayOfWeek: String(trigger.config.dayOfWeek || 'MONDAY'),
      misfirePolicy: trigger.misfirePolicy
    }
  ]))
}

async function loadCompensations(decisions: AuthorizationDecision[]) {
  const stepRunIds = [...new Set(decisions
    .filter((item) => item.stepRunId && item.riskLevel === 'R1' && item.decision === 'ALLOW')
    .map((item) => String(item.stepRunId)))]
  if (!stepRunIds.length) return
  const responses = await Promise.allSettled(stepRunIds.map((id) => getCompensation(id)))
  const next = { ...compensations.value }
  responses.forEach((response, index) => {
    if (response.status === 'fulfilled') next[stepRunIds[index]] = response.value.data
  })
  compensations.value = next
}

async function stateAction(name: string) {
  if (!mission.value || action.value) return
  action.value = name
  error.value = ''
  feedback.value = ''
  try {
    const current = mission.value
    if (name === 'pause') mission.value = (await pauseMission(current.id, current.version)).data
    if (name === 'resume') mission.value = (await resumeMission(current.id, current.version)).data
    feedback.value = name === 'pause'
      ? '持续任务已暂停；下一动作前会重新读取状态。'
      : '持续任务已恢复，将按当前有效授权继续。'
  } catch (exception) {
    error.value = toAppError(exception, '持续任务操作失败，请刷新后重试。').message
  } finally {
    action.value = ''
  }
}

async function runNow() {
  if (!mission.value || action.value) return
  action.value = 'run'
  error.value = ''
  feedback.value = ''
  try {
    const result = (await runMissionNow(mission.value.id)).data as {
      agentTaskId?: string
      agentTask?: { id?: string | number }
    }
    feedback.value = '已创建一次手动触发记录，运行会沿用同一授权与预算检查。'
    await load(false)
    const taskId = result.agentTask?.id || result.agentTaskId
    if (taskId) await router.push(`/agent-tasks/${taskId}`)
  } catch (exception) {
    error.value = toAppError(exception, '立即运行失败，请确认任务处于运行中且灰度已开放。').message
  } finally {
    action.value = ''
  }
}

async function revoke() {
  if (!mission.value) return
  revokeOpen.value = false
  action.value = 'revoke'
  error.value = ''
  try {
    mission.value = (await revokeMission(mission.value.id, mission.value.version)).data
    feedback.value = '持续任务和全部授权版本已撤销；后续动作会被拒绝。'
  } catch (exception) {
    error.value = toAppError(exception, '撤销失败，请刷新后重试。').message
  } finally {
    action.value = ''
  }
}

async function compensate() {
  if (!compensationTarget.value) return
  const target = compensationTarget.value
  compensationTarget.value = null
  action.value = `compensate-${target.stepRunId}`
  error.value = ''
  try {
    const next = (await compensateAgentAction(target.stepRunId)).data
    compensations.value = { ...compensations.value, [target.stepRunId]: next }
    feedback.value = next.status === 'SUCCEEDED'
      ? '补偿已完成，原自动变更已在前置条件仍成立时撤销。'
      : `补偿结果：${next.status}。系统没有覆盖发生冲突的外部状态。`
  } catch (exception) {
    error.value = toAppError(exception, '补偿执行失败；系统未覆盖当前外部状态。').message
    await load(false)
  } finally {
    action.value = ''
  }
}

async function saveTrigger(triggerId: string) {
  if (!mission.value || action.value) return
  const trigger = mission.value.triggers?.find((item) => item.id === triggerId)
  const draft = triggerDrafts.value[triggerId]
  if (!trigger || !draft) return
  action.value = `trigger-${triggerId}`
  error.value = ''
  feedback.value = ''
  try {
    await updateMissionTrigger(mission.value.id, trigger.id, mission.value.version, {
      triggerVersion: trigger.version,
      type: trigger.type,
      timezone: trigger.timezone,
      misfirePolicy: draft.misfirePolicy,
      enabled: true,
      config: trigger.type === 'PROJECT_STATE'
        ? trigger.config
        : {
            frequency: draft.frequency,
            time: draft.time,
            ...(draft.frequency === 'WEEKLY' ? { dayOfWeek: draft.dayOfWeek } : {})
          }
    })
    feedback.value = '触发计划已保存；时间按 IANA 时区计算并以 UTC 存储。'
    await load(false)
  } catch (exception) {
    error.value = toAppError(exception, '触发计划保存失败。').message
  } finally {
    action.value = ''
  }
}

async function disableTrigger(triggerId: string) {
  if (!mission.value || action.value) return
  const trigger = mission.value.triggers?.find((item) => item.id === triggerId)
  if (!trigger) return
  action.value = `disable-trigger-${triggerId}`
  error.value = ''
  try {
    await disableMissionTrigger(
      mission.value.id,
      trigger.id,
      mission.value.version,
      trigger.version
    )
    feedback.value = '触发器已停用；历史触发记录继续保留。'
    await load(false)
  } catch (exception) {
    error.value = toAppError(exception, '触发器停用失败。').message
  } finally {
    action.value = ''
  }
}

function decisionLabel(value: AuthorizationDecision['decision']) {
  return { ALLOW: '允许', REQUIRE_CONFIRMATION: '需确认', DENY: '拒绝' }[value]
}
</script>

<template>
  <div class="page detail-page">
    <LoadingState v-if="loading" label="正在加载持续任务" :cards="3" />
    <ErrorState v-else-if="error && !mission" title="持续任务加载失败" :message="error" @retry="load" />
    <template v-else-if="mission">
      <RouterLink class="back" to="/missions"><ArrowLeft :size="16" />返回持续任务</RouterLink>
      <header class="mission-header">
        <div>
          <div class="status-line"><MissionStatusBadge :status="mission.status" /><span>授权最长至 {{ formatBeijingTime(mission.expiresAt) }}</span><span>{{ eventStreamConnected ? '实时更新已连接' : '实时更新重连中' }}</span></div>
          <h1>{{ mission.title }}</h1>
          <p>{{ mission.goal }}</p>
        </div>
        <div class="controls">
          <RouterLink v-if="availableActions.has('SHADOW')" :to="`/missions/${mission.id}/shadow`"><AppButton variant="secondary"><Eye :size="16" />预演</AppButton></RouterLink>
          <RouterLink v-if="availableActions.has('APPROVE_GRANT')" :to="`/missions/${mission.id}/grant`"><AppButton><ShieldCheck :size="16" />审查授权</AppButton></RouterLink>
          <AppButton v-if="availableActions.has('RUN_NOW')" :loading="action === 'run'" @click="runNow"><Play :size="16" />立即运行</AppButton>
          <AppButton v-if="availableActions.has('PAUSE')" variant="secondary" :loading="action === 'pause'" @click="stateAction('pause')"><Pause :size="16" />暂停</AppButton>
          <AppButton v-if="availableActions.has('RESUME')" :loading="action === 'resume'" @click="stateAction('resume')"><Play :size="16" />恢复</AppButton>
          <AppButton variant="secondary" size="icon" aria-label="刷新持续任务" @click="load(false)"><RefreshCw :size="16" /></AppButton>
        </div>
      </header>

      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <section class="summary-strip">
        <div><span>下次运行</span><strong>{{ formatBeijingTime(mission.nextRunAt, '等待触发') }}</strong></div>
        <div><span>授权版本</span><strong>{{ mission.activeGrantVersion ? `v${mission.activeGrantVersion}` : '未批准' }}</strong></div>
        <div><span>触发器</span><strong>{{ mission.triggers?.filter((item) => item.enabled).length || 0 }} 个启用</strong></div>
        <div><span>周期</span><strong>{{ mission.periodType }}</strong></div>
      </section>

      <div class="workspace">
        <main>
          <AppCard>
            <div class="section-heading"><div><span>目标与完成标准</span><h2>委托结果定义</h2></div></div>
            <ul class="criteria"><li v-for="criterion in mission.completionCriteria" :key="criterion">{{ criterion }}</li></ul>
          </AppCard>

          <AppCard>
            <div class="section-heading"><div><span>运行历史</span><h2>最近触发与 Agent Task</h2></div><strong>{{ mission.recentRuns?.length || 0 }} 次</strong></div>
            <EmptyState v-if="!mission.recentRuns?.length" title="尚未产生运行" description="启用后会按计划或手动触发创建受控 Agent Task。" />
            <div v-else class="run-list">
              <RouterLink v-for="run in mission.recentRuns" :key="run.agentTaskId" :to="`/agent-tasks/${run.agentTaskId}`">
                <div><strong>{{ run.title }}</strong><span>{{ formatBeijingTime(run.scheduledFor || run.createdAt) }}</span></div>
                <span>{{ run.status }}</span>
              </RouterLink>
            </div>
          </AppCard>

          <AppCard>
            <div class="section-heading"><div><span>逐动作重检</span><h2>最近授权决策</h2></div><strong>{{ recentDecisions.length }} 条</strong></div>
            <EmptyState v-if="!recentDecisions.length" title="尚无授权决策" description="正式运行时，每个工具动作都会在 Java 策略层留下决策记录。" />
            <div v-else class="decision-list">
              <article v-for="decision in recentDecisions" :key="decision.id">
                <div class="decision-main">
                  <span class="decision" :class="decision.decision.toLowerCase()">{{ decisionLabel(decision.decision) }}</span>
                  <div><strong><code>{{ decision.toolRef }}</code> · {{ decision.operation }}</strong><p>{{ decision.reasonCode }} · {{ decision.riskLevel }} · 授权 v{{ decision.grantVersion }}</p></div>
                </div>
                <template v-if="decision.stepRunId && compensations[decision.stepRunId]">
                  <CompensationStatus :compensation="compensations[decision.stepRunId]" />
                  <AppButton
                    v-if="compensations[decision.stepRunId].status === 'AVAILABLE'"
                    size="sm"
                    variant="secondary"
                    :loading="action === `compensate-${decision.stepRunId}`"
                    @click="compensationTarget = compensations[decision.stepRunId]"
                  ><RotateCcw :size="15" />撤销该自动变更</AppButton>
                </template>
              </article>
            </div>
          </AppCard>
        </main>

        <aside>
          <AppCard>
            <h2><CalendarClock :size="18" />触发计划</h2>
            <div class="trigger-list">
              <article v-for="trigger in mission.triggers" :key="trigger.id">
                <strong>{{ trigger.type }} · {{ trigger.enabled ? '已启用' : '已停用' }}</strong>
                <p>{{ trigger.timezone }} · 错过后 {{ trigger.misfirePolicy === 'RUN_ONCE' ? '补跑一次' : '跳过' }}</p>
                <small>下次 {{ formatBeijingTime(trigger.nextFireAt, '等待事件') }}</small>
                <div v-if="trigger.enabled && triggerDrafts[trigger.id]" class="trigger-editor">
                  <template v-if="trigger.type !== 'PROJECT_STATE'">
                    <select v-model="triggerDrafts[trigger.id].frequency" :aria-label="`触发频率 ${trigger.id}`"><option value="DAILY">每天</option><option value="WEEKDAYS">工作日</option><option value="WEEKLY">每周</option></select>
                    <select v-if="triggerDrafts[trigger.id].frequency === 'WEEKLY'" v-model="triggerDrafts[trigger.id].dayOfWeek" :aria-label="`触发星期 ${trigger.id}`"><option value="MONDAY">周一</option><option value="FRIDAY">周五</option><option value="SUNDAY">周日</option></select>
                    <input v-model="triggerDrafts[trigger.id].time" type="time" :aria-label="`触发时间 ${trigger.id}`" />
                  </template>
                  <select v-model="triggerDrafts[trigger.id].misfirePolicy" :aria-label="`错过触发策略 ${trigger.id}`"><option value="RUN_ONCE">补跑一次</option><option value="SKIP">跳过</option></select>
                  <div><AppButton size="sm" variant="secondary" :loading="action === `trigger-${trigger.id}`" @click="saveTrigger(trigger.id)">保存</AppButton><AppButton size="sm" variant="ghost" :loading="action === `disable-trigger-${trigger.id}`" @click="disableTrigger(trigger.id)">停用</AppButton></div>
                </div>
              </article>
            </div>
          </AppCard>
          <AppCard v-if="latestGrant">
            <h2><ShieldCheck :size="18" />当前授权边界</h2>
            <p class="grant-summary">{{ latestGrant.summary }}</p>
            <dl><div><dt>版本</dt><dd>v{{ latestGrant.version }} · {{ latestGrant.status }}</dd></div><div><dt>规则</dt><dd>{{ latestGrant.rules.length }} 条结构化规则</dd></div><div><dt>到期</dt><dd>{{ formatBeijingTime(latestGrant.expiresAt) }}</dd></div></dl>
            <RouterLink v-if="availableActions.has('EDIT_GRANT')" :to="`/missions/${mission.id}/grant`">查看和调整授权</RouterLink>
          </AppCard>
          <AppCard><h2>周期预算</h2><PeriodBudgetMeter :limits="mission.periodBudget" :usage="mission.periodUsage" /></AppCard>
          <AppCard v-if="availableActions.has('REVOKE')" class="danger-zone">
            <h2><CircleStop :size="18" />撤销委托</h2>
            <p>立即使全部授权版本失效；已开始的动作也会在下一策略检查前停止。</p>
            <AppButton variant="ghost" @click="revokeOpen = true">撤销持续任务</AppButton>
          </AppCard>
        </aside>
      </div>

      <ConfirmActionDialog
        :open="revokeOpen"
        title="撤销这个持续任务？"
        description="全部授权版本会立即失效，后续动作默认拒绝。历史运行和审计记录仍会保留。"
        confirm-label="确认撤销"
        danger
        :busy="action === 'revoke'"
        @update:open="revokeOpen = $event"
        @confirm="revoke"
      />
      <ConfirmActionDialog
        :open="Boolean(compensationTarget)"
        title="撤销这次自动变更？"
        description="仅当前置快照、资源版本和外部状态仍匹配时执行；存在冲突时系统会停止，不覆盖当前内容。"
        confirm-label="执行受控撤销"
        :busy="action.startsWith('compensate-')"
        @update:open="!$event && (compensationTarget = null)"
        @confirm="compensate"
      />
    </template>
  </div>
</template>

<style scoped>
.detail-page { width: min(1280px, 100%); margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.mission-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
.mission-header > div:first-child { min-width: 0; }.status-line { display: flex; align-items: center; gap: var(--space-3); color: var(--muted-foreground); font-size: 12px; }
h1 { margin: var(--space-3) 0 6px; font-size: clamp(26px, 4vw, 36px); letter-spacing: -.03em; }.mission-header p { max-width: 760px; margin: 0; color: var(--muted-foreground); line-height: 1.6; }
.controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }.controls a { text-decoration: none; }
.summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); }
.summary-strip div { display: grid; gap: 5px; padding: var(--space-3) var(--space-4); }.summary-strip div:not(:last-child) { border-right: 1px solid var(--border); }.summary-strip span { color: var(--muted-foreground); font-size: 11px; }.summary-strip strong { font-size: 13px; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) 330px; align-items: start; gap: var(--space-4); }.workspace main, .workspace aside { display: grid; min-width: 0; gap: var(--space-4); }.workspace aside { position: sticky; top: calc(var(--lyle-header-height) + var(--space-4)); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); }.section-heading span { color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }.section-heading h2, aside h2 { margin: 4px 0 0; font-size: 17px; }.section-heading > strong { color: var(--muted-foreground); font-size: 12px; }
.criteria { display: grid; gap: var(--space-2); margin: 0; padding-left: 20px; line-height: 1.55; }
.run-list, .decision-list, .trigger-list { display: grid; gap: var(--space-2); }.run-list a { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); border-top: 1px solid var(--border); padding: var(--space-3) 0; color: inherit; text-decoration: none; }.run-list a > div { display: grid; gap: 4px; }.run-list span { color: var(--muted-foreground); font-size: 12px; }
.decision-list > article { display: grid; grid-template-columns: minmax(0, 1fr) minmax(230px, auto) auto; align-items: center; gap: var(--space-3); border-top: 1px solid var(--border); padding: var(--space-3) 0; }.decision-main { display: flex; align-items: flex-start; gap: var(--space-3); }.decision-main p { margin: 5px 0 0; color: var(--muted-foreground); font-size: 11px; }.decision { border-radius: 999px; padding: 4px 8px; font-size: 11px; font-weight: 750; white-space: nowrap; }.decision.allow { background: var(--success-soft); color: var(--success-strong); }.decision.require_confirmation { background: var(--warning-soft); color: var(--warning-strong); }.decision.deny { background: var(--danger-soft); color: var(--danger-strong); }
aside h2 { display: flex; align-items: center; gap: 7px; margin: 0 0 var(--space-3); }.trigger-list article { border-top: 1px solid var(--border); padding-top: var(--space-3); }.trigger-list p, .grant-summary, .danger-zone p { margin: 5px 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }.trigger-list small { color: var(--muted-foreground); font-size: 11px; }.workspace aside dl { display: grid; gap: var(--space-2); margin: var(--space-3) 0; }.workspace aside dl div { display: flex; justify-content: space-between; gap: var(--space-3); font-size: 12px; }.workspace aside dt { color: var(--muted-foreground); }.workspace aside dd { margin: 0; text-align: right; }.workspace aside a { color: var(--primary); font-size: 12px; font-weight: 650; }
.trigger-editor { display: grid; gap: 7px; margin-top: var(--space-3); }.trigger-editor select, .trigger-editor input { width: 100%; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--surface); padding: 7px 9px; color: var(--foreground); font: inherit; font-size: 12px; }.trigger-editor > div { display: flex; justify-content: flex-end; gap: 5px; }
.danger-zone { border-color: var(--danger-border); }.danger-zone :deep(button) { color: var(--danger-strong); }.feedback { border: 1px solid var(--success-border); border-radius: var(--radius-md); background: var(--success-soft); padding: var(--space-3); color: var(--success-strong); }.error { color: var(--danger-strong); }
@media (max-width: 980px) { .workspace { grid-template-columns: 1fr; }.workspace aside { position: static; grid-template-columns: 1fr 1fr; }.decision-list > article { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .mission-header { flex-direction: column; }.controls { width: 100%; justify-content: stretch; }.controls :deep(button), .controls a { flex: 1; }.summary-strip { grid-template-columns: 1fr 1fr; }.summary-strip div:nth-child(2) { border-right: 0; }.summary-strip div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }.workspace aside { grid-template-columns: 1fr; } }
</style>
