<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Ban, CheckCircle2, Save, ShieldCheck } from '@lucide/vue'
import {
  approveMissionGrant,
  createMissionGrant,
  getMission,
  type GrantRule,
  type Mission
} from '@/api/missions'
import { toAppError } from '@/api/errors'
import { formatBeijingTime } from '@/domain/date-time'
import PeriodBudgetMeter from '@/components/domain/mission/PeriodBudgetMeter.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'

const route = useRoute()
const router = useRouter()
const mission = ref<Mission | null>(null)
const loading = ref(false)
const approving = ref(false)
const saving = ref(false)
const error = ref('')
const feedback = ref('')
const grant = computed(() => mission.value?.grants?.[0])
const editable = computed(() => Boolean(
  mission.value && grant.value
  && ['ACTIVE', 'PAUSED'].includes(mission.value.status)
  && grant.value.status === 'ACTIVE'
))
const needsApproval = computed(() => Boolean(
  grant.value && ['DRAFT', 'PENDING_APPROVAL'].includes(grant.value.status)
))
const allowTodo = ref(false)
const allowFilePatch = ref(false)
const maxToolCalls = ref(0)
const maxModelTokens = ref(0)
const maxCostMicros = ref(0)
const maxWallTimeMillis = ref(0)

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    mission.value = (await getMission(String(route.params.id))).data
    initializeEditor()
  } catch (exception) {
    error.value = toAppError(exception, '授权详情加载失败。').message
  } finally {
    loading.value = false
  }
}

function initializeEditor() {
  if (!grant.value) return
  allowTodo.value = grant.value.rules.some((rule) => rule.toolRefs.includes('todo.propose'))
  allowFilePatch.value = grant.value.rules.some((rule) => rule.toolRefs.includes('file.patch.propose'))
  maxToolCalls.value = Number(grant.value.budgetPolicy.maxToolCalls || mission.value?.periodBudget.maxToolCalls || 0)
  maxModelTokens.value = Number(grant.value.budgetPolicy.maxModelTokens || mission.value?.periodBudget.maxModelTokens || 0)
  maxCostMicros.value = Number(grant.value.budgetPolicy.maxCostMicros || mission.value?.periodBudget.maxCostMicros || 0)
  maxWallTimeMillis.value = Number(grant.value.budgetPolicy.maxWallTimeMillis || mission.value?.periodBudget.maxWallTimeMillis || 0)
}

async function approve() {
  if (!mission.value || !grant.value) return
  approving.value = true
  error.value = ''
  try {
    const next = (await approveMissionGrant(mission.value.id, grant.value.version, mission.value.version)).data
    await router.push(`/missions/${next.id}`)
  } catch (exception) {
    error.value = toAppError(exception, '授权批准失败，请刷新后重新审查。').message
  } finally {
    approving.value = false
  }
}

async function saveNewVersion() {
  if (!mission.value || !grant.value || saving.value) return
  saving.value = true
  error.value = ''
  feedback.value = ''
  try {
    const rules = grant.value.rules
      .filter((rule) => rule.maxRisk === 'R0')
      .map((rule) => ({ ...rule, resourceScope: { ...rule.resourceScope } }))
    if (allowTodo.value && mission.value.projectId) rules.push(todoRule(Number(mission.value.projectId)))
    const workspaceIds = grant.value.rules
      .flatMap((rule) => rule.resourceScope.workspaceIds || [])
    if (allowFilePatch.value && workspaceIds[0]) rules.push(fileRule(workspaceIds[0]))
    const next = (await createMissionGrant(mission.value.id, mission.value.version, {
      summary: '用户通过结构化编辑器调整了工具、资源范围和周期预算。',
      rules,
      budgetPolicy: {
        maxToolCalls: maxToolCalls.value,
        maxModelTokens: maxModelTokens.value,
        maxCostMicros: maxCostMicros.value,
        maxWallTimeMillis: maxWallTimeMillis.value
      },
      expiresAt: grant.value.expiresAt
    })).data
    mission.value = next
    initializeEditor()
    feedback.value = next.grantChange?.requiresApproval
      ? `授权 v${next.grantChange.version} 扩大了边界，必须再次明确批准后才会生效。`
      : `授权 v${next.grantChange?.version || next.grants?.[0]?.version} 仅收紧边界，已在下一动作前生效。`
  } catch (exception) {
    error.value = toAppError(exception, '新授权版本保存失败。').message
  } finally {
    saving.value = false
  }
}

function todoRule(projectId: number): GrantRule {
  return {
    id: 'rule-r1-project-task-create',
    effect: 'allow',
    toolRefs: ['todo.propose'],
    operations: ['create'],
    resourceScope: { projectIds: [projectId] },
    allowedFields: ['title', 'dueAt', 'items'],
    maxRisk: 'R1',
    requiresReversible: true,
    maxCallsPerRun: 3
  }
}

function fileRule(workspaceId: number): GrantRule {
  return {
    id: 'rule-r1-workspace-file-patch',
    effect: 'allow',
    toolRefs: ['file.patch.propose'],
    operations: ['patch'],
    resourceScope: { workspaceIds: [workspaceId] },
    allowedFields: ['relativePath', 'newContent', 'expectedSha256'],
    maxRisk: 'R1',
    requiresReversible: true,
    maxCallsPerRun: 1
  }
}
</script>

<template>
  <div class="page grant-page">
    <RouterLink class="back" :to="`/missions/${route.params.id}/shadow`"><ArrowLeft :size="16" />返回预演</RouterLink>
    <header><span class="eyebrow">委托授权批准</span><h1>批准边界，不是批准无限自动</h1><p>扩大工具、资源、预算、频率或有效期都会生成新版本并再次来到这里。</p></header>
    <LoadingState v-if="loading" label="正在加载授权版本" :cards="3" />
    <ErrorState v-else-if="error && !mission" title="授权加载失败" :message="error" @retry="load" />
    <template v-else-if="mission && grant">
      <AppCard class="summary"><ShieldCheck :size="22" /><div><strong>授权 v{{ grant.version }}</strong><p>{{ grant.summary }}</p><small>有效至 {{ formatBeijingTime(grant.expiresAt) }}</small></div></AppCard>
      <div class="columns">
        <AppCard>
          <h2><CheckCircle2 :size="19" />明确允许</h2>
          <article v-for="rule in grant.rules.filter((item) => item.effect === 'allow')" :key="rule.id">
            <strong>{{ rule.toolRefs.join('、') }} · {{ rule.operations.join('、') }}</strong>
            <p>{{ rule.maxRisk }} · {{ rule.requiresReversible ? '必须支持撤销' : '只读或无需补偿' }} · 单次最多 {{ rule.maxCallsPerRun }} 次</p>
            <small>项目 {{ rule.resourceScope.projectIds?.join('、') || '—' }}；工作区 {{ rule.resourceScope.workspaceIds?.join('、') || '—' }}</small>
          </article>
        </AppCard>
        <AppCard class="forbidden">
          <h2><Ban :size="19" />始终不允许</h2>
          <ul><li>支付、转账、账号安全与权限变更</li><li>公开发布、对外发送和永久删除</li><li>Git commit、push、merge、tag 与正式发布</li><li>通配写工具、任意资源范围或模型自行扩大授权</li></ul>
        </AppCard>
      </div>
      <AppCard><h2>周期预算</h2><PeriodBudgetMeter :limits="mission.periodBudget" /></AppCard>
      <AppCard v-if="editable" class="editor">
        <h2>创建新的不可变授权版本</h2>
        <p>取消能力或降低预算会立即收紧；新增写能力或提高预算必须再次明确批准。</p>
        <div class="toggles">
          <label><input v-model="allowTodo" type="checkbox" /><span><strong>允许创建单个项目内部任务</strong><small>R1 · 仅绑定项目 · 必须可补偿 · 单次最多 3 次</small></span></label>
          <label :class="{ disabled: !grant.rules.some((rule) => rule.toolRefs.includes('file.patch.propose')) }"><input v-model="allowFilePatch" type="checkbox" :disabled="!grant.rules.some((rule) => rule.toolRefs.includes('file.patch.propose'))" /><span><strong>允许受控文件 Patch</strong><small>只有原授权已声明具体工作区与写入目标时可保留；新增目标需从草稿流程重新生成。</small></span></label>
        </div>
        <div class="budget-editor">
          <label>工具调用上限<input v-model.number="maxToolCalls" type="number" min="1" /></label>
          <label>模型 Token 上限<input v-model.number="maxModelTokens" type="number" min="1" /></label>
          <label>费用上限（μ）<input v-model.number="maxCostMicros" type="number" min="1" /></label>
          <label>执行时长上限（ms）<input v-model.number="maxWallTimeMillis" type="number" min="1" /></label>
        </div>
        <AppButton :loading="saving" @click="saveNewVersion"><Save :size="16" />保存为新授权版本</AppButton>
      </AppCard>
      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <footer>
        <RouterLink to="/missions"><AppButton variant="secondary">{{ needsApproval ? '暂不批准' : '返回持续任务' }}</AppButton></RouterLink>
        <AppButton v-if="needsApproval" :loading="approving" @click="approve">{{ mission.status === 'AWAITING_APPROVAL' ? '批准此授权并启用持续任务' : '批准新授权版本' }}</AppButton>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.grant-page { width: min(1050px, 100%); margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.eyebrow { color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 7px 0 5px; font-size: 32px; letter-spacing: -.03em; } header p { margin: 0; color: var(--muted-foreground); }
.summary { display: flex; align-items: flex-start; gap: var(--space-3); border-color: var(--info-border); background: var(--info-soft); }.summary p { margin: 5px 0; line-height: 1.55; }.summary small { color: var(--muted-foreground); }
.columns { display: grid; grid-template-columns: 1.3fr .7fr; gap: var(--space-4); }
h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--space-3); font-size: 17px; }
article { border-top: 1px solid var(--border); padding: var(--space-3) 0; } article p { margin: 5px 0; color: var(--muted-foreground); } article small { color: var(--muted-foreground); }
.forbidden { border-color: var(--danger-border); background: var(--danger-soft); }.forbidden ul { display: grid; gap: var(--space-3); margin: 0; padding-left: 20px; line-height: 1.5; }
.editor > p { color: var(--muted-foreground); line-height: 1.55; }.toggles { display: grid; gap: var(--space-2); }.toggles label { display: flex; align-items: flex-start; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-3); }.toggles input { margin-top: 3px; }.toggles span, .toggles small { display: block; }.toggles small { margin-top: 4px; color: var(--muted-foreground); line-height: 1.45; }.toggles .disabled { opacity: .58; }.budget-editor { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); margin: var(--space-4) 0; }.budget-editor label { display: grid; gap: 6px; color: var(--muted-foreground); font-size: 12px; font-weight: 650; }.budget-editor input { width: 100%; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--surface); padding: 9px 10px; color: var(--foreground); font: inherit; }
footer { display: flex; justify-content: flex-end; gap: var(--space-2); } footer a { text-decoration: none; }
.feedback { border: 1px solid var(--success-border); border-radius: var(--radius-md); background: var(--success-soft); padding: var(--space-3); color: var(--success-strong); }.error { color: var(--danger-strong); }
@media (max-width: 760px) { .columns, .budget-editor { grid-template-columns: 1fr; } footer { flex-direction: column-reverse; } footer a, footer button { width: 100%; } }
</style>
