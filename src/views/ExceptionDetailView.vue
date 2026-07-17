<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, ExternalLink, Eye, ShieldCheck, TriangleAlert } from '@lucide/vue'
import {
  acknowledgeMissionException,
  dismissMissionException,
  getMission,
  getMissionException,
  resolveMissionException,
  type Mission,
  type MissionException
} from '@/api/missions'
import { toAppError } from '@/api/errors'
import { formatBeijingTime } from '@/domain/date-time'
import MissionStatusBadge from '@/components/domain/mission/MissionStatusBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'

const route = useRoute()
const router = useRouter()
const exception = ref<MissionException | null>(null)
const mission = ref<Mission | null>(null)
const loading = ref(true)
const action = ref('')
const pendingResolution = ref('')
const error = ref('')
const feedback = ref('')
const open = computed(() => ['OPEN', 'ACKNOWLEDGED'].includes(exception.value?.status || ''))

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    exception.value = (await getMissionException(String(route.params.id))).data
    mission.value = (await getMission(exception.value.missionId)).data
  } catch (exceptionValue) {
    error.value = toAppError(exceptionValue, '异常事项加载失败。').message
  } finally {
    loading.value = false
  }
}

async function acknowledge() {
  if (!exception.value || action.value) return
  action.value = 'ack'
  error.value = ''
  try {
    exception.value = (await acknowledgeMissionException(exception.value.id)).data
    feedback.value = '已知悉。持续任务不会因此自动扩大授权或跳过安全检查。'
  } catch (exceptionValue) {
    error.value = toAppError(exceptionValue, '更新异常状态失败。').message
  } finally {
    action.value = ''
  }
}

async function dismiss() {
  if (!exception.value || action.value) return
  action.value = 'dismiss'
  error.value = ''
  try {
    exception.value = (await dismissMissionException(exception.value.id)).data
    feedback.value = '已忽略这条异常；审计记录仍会保留。'
  } catch (exceptionValue) {
    error.value = toAppError(exceptionValue, '忽略异常失败。').message
  } finally {
    action.value = ''
  }
}

async function resolve() {
  if (!exception.value || !pendingResolution.value || action.value) return
  const selected = pendingResolution.value
  pendingResolution.value = ''
  action.value = selected
  error.value = ''
  try {
    exception.value = (await resolveMissionException(exception.value.id, selected)).data
    feedback.value = '处理选择已记录。涉及执行、补充信息或授权调整的动作仍会进入对应受控页面。'
    if (selected === 'ADJUST_GRANT') await router.push(`/missions/${exception.value.missionId}/grant`)
    if (['CONTINUE', 'SKIP', 'PROVIDE_INPUT', 'END_RUN'].includes(selected) && exception.value.agentTaskId) {
      await router.push(`/agent-tasks/${exception.value.agentTaskId}`)
    }
  } catch (exceptionValue) {
    error.value = toAppError(exceptionValue, '异常处理失败。').message
  } finally {
    action.value = ''
  }
}

function actionLabel(value: string) {
  return {
    CONTINUE: '前往任务继续处理',
    SKIP: '前往任务选择跳过',
    PROVIDE_INPUT: '前往任务补充信息',
    ADJUST_GRANT: '进入授权调整流程',
    END_RUN: '前往任务终止运行',
    VIEW_EVIDENCE: '查看证据',
    DISMISS: '忽略'
  }[value] || value
}

function choose(value: string) {
  if (value === 'VIEW_EVIDENCE') {
    document.getElementById('evidence')?.scrollIntoView({ behavior: 'smooth' })
    return
  }
  if (value === 'DISMISS') {
    void dismiss()
    return
  }
  pendingResolution.value = value
}
</script>

<template>
  <div class="page exception-detail">
    <LoadingState v-if="loading" label="正在加载异常事项" :cards="2" />
    <ErrorState v-else-if="error && !exception" title="异常事项加载失败" :message="error" @retry="load" />
    <template v-else-if="exception">
      <RouterLink class="back" to="/exceptions"><ArrowLeft :size="16" />返回异常收件箱</RouterLink>
      <header class="exception-header">
        <span class="icon" :class="exception.severity.toLowerCase()"><TriangleAlert :size="22" /></span>
        <div><span class="eyebrow">{{ exception.type }} · {{ exception.severity }}</span><h1>{{ exception.title }}</h1><p>{{ exception.summary }}</p></div>
        <span class="status">{{ exception.status }}</span>
      </header>
      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="workspace">
        <main>
          <AppCard>
            <h2>影响与最后安全状态</h2>
            <p>该动作已停止或转入等待状态。没有匹配授权、预算不足、补偿冲突或外部状态变化时，Lyle 不会静默继续。</p>
            <dl><div><dt>发现时间</dt><dd>{{ formatBeijingTime(exception.createdAt) }}</dd></div><div><dt>关联任务</dt><dd>{{ exception.agentTaskId ? `Agent Task #${exception.agentTaskId}` : '尚未创建或无法关联' }}</dd></div><div><dt>解决时间</dt><dd>{{ formatBeijingTime(exception.resolvedAt, '尚未解决') }}</dd></div></dl>
          </AppCard>

          <AppCard v-if="open">
            <h2>可选动作</h2>
            <p class="hint">异常页不会透传任意工具参数，也不会隐式扩大授权。涉及任务状态的选择会带你前往 V5 运行台完成。</p>
            <div class="actions">
              <AppButton v-for="item in exception.availableActions" :key="item" :variant="item === 'END_RUN' ? 'danger' : 'secondary'" @click="choose(item)">
                <Eye v-if="item === 'VIEW_EVIDENCE'" :size="15" /><ShieldCheck v-else-if="item === 'ADJUST_GRANT'" :size="15" /><ExternalLink v-else :size="15" />
                {{ actionLabel(item) }}
              </AppButton>
            </div>
          </AppCard>

          <AppCard id="evidence">
            <h2>证据引用</h2>
            <ul v-if="exception.evidenceRefs.length"><li v-for="reference in exception.evidenceRefs" :key="reference"><code>{{ reference }}</code></li></ul>
            <p v-else>没有附加证据引用；审计记录仍保留异常类型、去重键和关联对象。</p>
          </AppCard>
        </main>
        <aside>
          <AppCard v-if="mission">
            <h2>关联持续任务</h2>
            <MissionStatusBadge :status="mission.status" />
            <h3>{{ mission.title }}</h3>
            <p>{{ mission.goal }}</p>
            <RouterLink :to="`/missions/${mission.id}`">查看任务、授权与运行记录</RouterLink>
          </AppCard>
          <AppCard v-if="exception.status === 'OPEN'">
            <h2>暂不处理</h2>
            <p>标记“已知悉”不会继续执行，也不会改变权限；它只把事项移到已知悉分类。</p>
            <AppButton variant="secondary" :loading="action === 'ack'" @click="acknowledge"><Check :size="15" />标记已知悉</AppButton>
          </AppCard>
        </aside>
      </div>

      <ConfirmActionDialog
        :open="Boolean(pendingResolution)"
        :title="actionLabel(pendingResolution)"
        description="这会记录你的处理选择；如果涉及继续、跳过、补充信息、终止或扩大授权，仍需在对应受控页面完成。"
        confirm-label="记录并继续"
        :danger="pendingResolution === 'END_RUN'"
        :busy="Boolean(action)"
        @update:open="!$event && (pendingResolution = '')"
        @confirm="resolve"
      />
    </template>
  </div>
</template>

<style scoped>
.exception-detail { width: min(1100px, 100%); margin: 0 auto; }.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.exception-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: flex-start; gap: var(--space-4); }.icon { display: grid; width: 46px; height: 46px; place-items: center; border-radius: var(--radius-xl); background: var(--warning-soft); color: var(--warning-strong); }.icon.high, .icon.critical { background: var(--danger-soft); color: var(--danger-strong); }.eyebrow { color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .08em; }.exception-header h1 { margin: 6px 0; font-size: clamp(25px, 4vw, 34px); }.exception-header p { margin: 0; color: var(--muted-foreground); line-height: 1.6; }.status { border-radius: 999px; background: var(--surface-muted); padding: 5px 9px; color: var(--muted-foreground); font-size: 11px; font-weight: 750; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) 300px; align-items: start; gap: var(--space-4); }.workspace main, .workspace aside { display: grid; gap: var(--space-4); }.workspace aside { position: sticky; top: calc(var(--lyle-header-height) + var(--space-4)); }
h2 { margin: 0 0 var(--space-3); font-size: 17px; }.workspace p { color: var(--muted-foreground); line-height: 1.55; }.workspace dl { display: grid; gap: var(--space-3); margin: var(--space-4) 0 0; }.workspace dl div { display: flex; justify-content: space-between; gap: var(--space-3); font-size: 12px; }.workspace dt { color: var(--muted-foreground); }.workspace dd { margin: 0; text-align: right; }.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }.hint { font-size: 12px; }.workspace ul { display: grid; gap: var(--space-2); padding-left: 20px; }.workspace code { overflow-wrap: anywhere; color: var(--muted-foreground); }.workspace aside h3 { margin: var(--space-3) 0 5px; }.workspace aside p { font-size: 12px; }.workspace aside a { color: var(--primary); font-size: 12px; font-weight: 650; }
.feedback { border: 1px solid var(--success-border); border-radius: var(--radius-md); background: var(--success-soft); padding: var(--space-3); color: var(--success-strong); }.error { color: var(--danger-strong); }
@media (max-width: 760px) { .exception-header { grid-template-columns: auto 1fr; }.exception-header .status { grid-column: 2; justify-self: start; }.workspace { grid-template-columns: 1fr; }.workspace aside { position: static; } }
</style>
