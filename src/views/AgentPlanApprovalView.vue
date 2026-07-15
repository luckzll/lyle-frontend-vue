<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowLeft, ArrowUp, LockKeyhole, Trash2 } from '@lucide/vue'
import { approveAgentPlan, getAgentTask, startAgentTask, updateAgentPlan, type AgentBudget, type AgentPlanStep, type AgentTask } from '@/api/agentTasks'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import { toAppError } from '@/api/errors'

const route = useRoute()
const router = useRouter()
const task = ref<AgentTask | null>(null)
const steps = ref<AgentPlanStep[]>([])
const budget = ref<AgentBudget | null>(null)
const loading = ref(true)
const saving = ref(false)
const approving = ref(false)
const error = ref('')
const dirty = ref(false)
const taskId = computed(() => String(route.params.id || ''))

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    task.value = (await getAgentTask(taskId.value)).data
    if (task.value.status !== 'AWAITING_PLAN_APPROVAL') {
      await router.replace(`/agent-tasks/${taskId.value}`)
      return
    }
    steps.value = task.value.plan?.steps.map((step) => ({ ...step, inputTemplate: { ...step.inputTemplate } })) || []
    budget.value = task.value.plan ? { ...task.value.plan.budget } : null
  } catch (exception) {
    error.value = toAppError(exception, '计划加载失败，请稍后重试。').message
  } finally {
    loading.value = false
  }
}

function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= steps.value.length) return
  const next = [...steps.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  steps.value = next.map((step, position) => ({ ...step, position: position + 1 }))
  dirty.value = true
}
function remove(index: number) { steps.value.splice(index, 1); steps.value = steps.value.map((step, position) => ({ ...step, position: position + 1 })); dirty.value = true }

async function save(): Promise<boolean> {
  if (!task.value?.plan || saving.value) return false
  saving.value = true
  error.value = ''
  try {
    task.value = (await updateAgentPlan(task.value.id, task.value.plan.version, task.value.version, {
      steps: steps.value,
      budget: budget.value || task.value.plan.budget,
      accessScope: task.value.plan.accessScope
    })).data
    steps.value = task.value.plan?.steps || []
    budget.value = task.value.plan ? { ...task.value.plan.budget } : null
    dirty.value = false
    return true
  } catch (exception) {
    error.value = toAppError(exception, '计划保存失败，请刷新后重试。').message
    return false
  } finally { saving.value = false }
}

async function approve() {
  if (!task.value?.plan || approving.value) return
  approving.value = true
  error.value = ''
  try {
    if (dirty.value && !(await save())) return
    if (!task.value?.plan) return
    let approved = (await approveAgentPlan(task.value.id, task.value.plan.version, task.value.version)).data
    if (approved.autonomyLevel > 0) approved = (await startAgentTask(approved.id, approved.version)).data
    await router.push(`/agent-tasks/${approved.id}`)
  } catch (exception) {
    error.value = toAppError(exception, '计划批准失败，请刷新后重试。').message
  } finally { approving.value = false }
}

async function saveOnly() {
  if (!task.value?.plan || saving.value || approving.value) return
  if (dirty.value && !(await save())) return
  await router.push(`/agent-tasks/${task.value.id}`)
}

function criteriaLabel(value: string | Record<string, unknown>) {
  return typeof value === 'string' ? value : String(value.criterion || value.title || value.description || '完成标准')
}
</script>

<template>
  <div class="page approval-page">
    <LoadingState v-if="loading" label="正在加载计划" :cards="3" />
    <ErrorState v-else-if="error && !task" title="计划加载失败" :message="error" @retry="load" />
    <template v-else-if="task?.plan">
      <RouterLink class="back" to="/agent-tasks"><ArrowLeft :size="16" />返回任务列表</RouterLink>
      <header class="intro"><span class="eyebrow">执行前审查 · 计划 v{{ task.plan.version }}</span><h1>{{ task.title }}</h1><p>确认 Lyle 对目标的理解、每一步将访问的范围，以及停止条件。</p></header>

      <AppCard class="section-card"><span class="section-no">01</span><div><h2>目标理解</h2><p class="goal">{{ task.goal }}</p><span class="inferred">Lyle 的理解 · 你可以返回修改目标</span></div></AppCard>
      <AppCard class="section-card"><span class="section-no">02</span><div><h2>完成标准</h2><ul><li v-for="criterion in task.completionCriteria" :key="criteriaLabel(criterion)">{{ criteriaLabel(criterion) }}</li></ul></div></AppCard>
      <AppCard class="section-card steps-card"><span class="section-no">03</span><div><h2>执行步骤</h2><p class="helper">可编辑名称与目的，也可以删除和调整顺序。写操作仍会逐次确认。</p><ol>
        <li v-for="(step, index) in steps" :key="step.stepKey">
          <span class="step-number">{{ index + 1 }}</span><div class="step-fields"><input v-model="step.title" aria-label="步骤名称" @input="dirty = true" /><textarea v-model="step.purpose" rows="2" aria-label="步骤目的" @input="dirty = true" /><footer><span>{{ step.toolRef }}</span><span :class="{ write: step.writeIntent }">{{ step.writeIntent ? '写入前确认' : step.riskLevel === 'EXTERNAL_READ' ? '外部只读' : '只读' }}</span></footer></div>
          <div class="step-actions"><button type="button" aria-label="上移" :disabled="index === 0" @click="move(index, -1)"><ArrowUp :size="15" /></button><button type="button" aria-label="下移" :disabled="index === steps.length - 1" @click="move(index, 1)"><ArrowDown :size="15" /></button><button type="button" aria-label="删除步骤" @click="remove(index)"><Trash2 :size="15" /></button></div>
        </li>
      </ol></div></AppCard>
      <div class="two-column">
        <AppCard class="section-card compact"><span class="section-no">04</span><div><h2>访问范围</h2><dl><div><dt>项目</dt><dd>{{ task.projectId ? `#${task.projectId}` : '未绑定项目' }}</dd></div><div><dt>网络</dt><dd>{{ task.plan.accessScope.network || 'NONE' }}</dd></div><div><dt>工具</dt><dd>{{ steps.map((step) => step.toolRef).join('、') }}</dd></div></dl></div></AppCard>
        <AppCard class="section-card compact"><span class="section-no">05</span><div><h2>预算与停止</h2><p class="budget-note">只能调低，不能突破当前计划或系统硬上限。</p><div v-if="budget" class="budget-grid"><label>最大步骤<input v-model.number="budget.maxSteps" type="number" min="1" :max="task.plan.budget.maxSteps" @input="dirty = true" /></label><label>工具调用<input v-model.number="budget.maxToolCalls" type="number" min="1" :max="task.plan.budget.maxToolCalls" @input="dirty = true" /></label><label>Token<input v-model.number="budget.maxModelTokens" type="number" min="1" :max="task.plan.budget.maxModelTokens" @input="dirty = true" /></label><label>费用（微单位）<input v-model.number="budget.maxCostMicros" type="number" min="1" :max="task.plan.budget.maxCostMicros" @input="dirty = true" /></label><label>最长毫秒<input v-model.number="budget.maxWallTimeMillis" type="number" min="1" :max="task.plan.budget.maxWallTimeMillis" @input="dirty = true" /></label><label>单步重试<input v-model.number="budget.maxRetriesPerStep" type="number" min="1" :max="task.plan.budget.maxRetriesPerStep" @input="dirty = true" /></label><label>无进展停止<input v-model.number="budget.maxConsecutiveNoProgress" type="number" min="1" :max="task.plan.budget.maxConsecutiveNoProgress" @input="dirty = true" /></label></div></div></AppCard>
      </div>
      <AppCard class="risk-card"><LockKeyhole :size="20" /><div><h2>风险说明</h2><p>批准计划只授权其中的只读范围。写操作会生成 Change Preview，并使用独立幂等键等待你确认；权限、目标或预算扩大时必须重新审批。</p></div></AppCard>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <footer class="approval-actions"><AppButton variant="ghost" :loading="saving" @click="saveOnly">仅保存计划</AppButton><AppButton variant="secondary" :loading="saving" :disabled="!dirty" @click="save">保存修改</AppButton><AppButton :loading="approving" :disabled="!steps.length" @click="approve">批准{{ task.autonomyLevel > 0 ? '并开始执行' : '计划' }}</AppButton></footer>
    </template>
  </div>
</template>

<style scoped>
.approval-page { width: min(960px, 100%); margin: 0 auto; padding-bottom: 84px; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.eyebrow { color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.intro h1 { margin: 7px 0 4px; font-size: 30px; letter-spacing: -.03em; }
.intro p, .helper { margin: 0; color: var(--muted-foreground); line-height: 1.55; }
.section-card { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: var(--space-4); }
.section-no { color: var(--primary); font-size: 12px; font-weight: 800; }
h2 { margin: 0 0 var(--space-3); font-size: 16px; }
.goal { margin: 0; font-size: 16px; line-height: 1.65; }
.inferred { display: inline-block; margin-top: var(--space-3); border-radius: 999px; background: var(--primary-soft); padding: 4px 8px; color: var(--primary); font-size: 11px; }
ul { margin: 0; padding-left: 20px; line-height: 1.8; }
ol { display: grid; gap: var(--space-3); margin: var(--space-4) 0 0; padding: 0; list-style: none; }
ol li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-3); }
.step-number { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; background: var(--surface-muted); font-size: 12px; font-weight: 800; }
.step-fields { display: grid; gap: var(--space-2); }
input, textarea { width: 100%; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; padding: 5px 7px; color: var(--foreground); font: inherit; }
input { font-weight: 700; } input:hover, textarea:hover, input:focus, textarea:focus { border-color: var(--input); background: var(--surface); }
.step-fields footer { display: flex; flex-wrap: wrap; gap: var(--space-2); color: var(--muted-foreground); font-size: 11px; }.step-fields footer span { border-radius: 999px; background: var(--surface-muted); padding: 3px 7px; }.step-fields footer .write { background: var(--warning-soft); color: var(--warning-strong); }
.step-actions { display: flex; gap: 2px; }.step-actions button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted-foreground); }.step-actions button:hover:not(:disabled) { background: var(--surface-muted); color: var(--foreground); }.step-actions button:disabled { opacity: .35; }
.two-column { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }.compact { height: 100%; }
dl { display: grid; gap: var(--space-2); margin: 0; } dl div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: var(--space-2); } dt { color: var(--muted-foreground); font-size: 12px; } dd { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.budget-note { margin: -6px 0 var(--space-3); color: var(--muted-foreground); font-size: 11px; }.budget-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }.budget-grid label { display: grid; gap: 4px; color: var(--muted-foreground); font-size: 11px; }.budget-grid input { border-color: var(--input); background: var(--surface); font-weight: 600; }
.risk-card { display: flex; align-items: flex-start; gap: var(--space-3); border-color: var(--info-border); background: var(--info-soft); color: var(--info-strong); }.risk-card h2 { margin-bottom: 4px; }.risk-card p { margin: 0; font-size: 13px; line-height: 1.6; }
.approval-actions { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; display: flex; justify-content: flex-end; gap: var(--space-2); border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, transparent); padding: var(--space-3) max(var(--space-6), calc((100vw - 960px) / 2)); backdrop-filter: blur(12px); }
.error { margin: 0; color: var(--danger-strong); font-size: 13px; }
@media (max-width: 700px) { .two-column { grid-template-columns: 1fr; }.section-card { grid-template-columns: 30px minmax(0, 1fr); }.steps-card { grid-template-columns: 1fr; }.steps-card > .section-no { display: none; } ol li { grid-template-columns: 28px minmax(0, 1fr); }.step-actions { grid-column: 2; }.approval-actions { padding: var(--space-3); }.approval-actions :deep(button:first-child) { display: none; } }
</style>
