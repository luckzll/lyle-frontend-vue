<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  createDraftFromIntent,
  createDraftFromTemplate,
  deleteAutomation,
  discardDraft as discardDraftRequest,
  enableAutomation,
  enableDraft as enableDraftRequest,
  getOnboarding,
  listAutomations,
  listExperienceTemplates,
  pauseAutomation,
  runAutomation as runAutomationRequest,
  runFirstInspection,
  trackEffectiveProgressAction,
  trackProductEvent,
  updateAutomation,
  updateOnboarding
} from '@/api/app'
import type { AutomationDraft, AutomationSummary, AutomationTemplate, AutomationUpdatePayload } from '@/api/types'
import AutomationCard from '@/components/domain/AutomationCard.vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import DetailDrawer from '@/components/layout/DetailDrawer.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { formatAutomationSchedule, formatAutomationTemplateCategory } from '@/domain/automation-schedule'
import { useWorkspaceStore } from '@/stores/workspace'

type AutomationAction = 'run' | 'toggle' | 'edit' | 'delete'
type Candidate = { id: number; name: string }
type OnboardingState = {
  completedAt?: string | null
  skippedAt?: string | null
  selectedProjectId?: number | null
  selectedWorkspaceId?: number | null
  candidates?: { projects?: Candidate[]; workspaces?: Candidate[] }
}

const route = useRoute()
const router = useRouter()
const workspace = useWorkspaceStore()
const templates = ref<AutomationTemplate[]>([])
const automations = ref<AutomationSummary[]>([])
const onboarding = ref<OnboardingState | null>(null)
const draft = ref<AutomationDraft | null>(null)
const intent = ref('')
const selectedProjectId = ref<number | undefined>()
const selectedWorkspaceId = ref<number | undefined>()
const loading = ref(false)
const pageLoading = ref(false)
const loadError = ref('')
const feedback = ref('')
const automationsError = ref('')
const automationActions = ref<Record<number, AutomationAction | undefined>>({})
const pendingDelete = ref<AutomationSummary | null>(null)
const editingAutomation = ref<AutomationSummary | null>(null)
const editError = ref('')
const editForm = ref({
  name: '',
  triggerType: 'schedule',
  scheduleExpr: '',
  timezone: 'Asia/Shanghai',
  status: 'paused',
  inputJson: '{}',
  maxRetries: 0,
  retryDelaySeconds: 60,
  notifyOnFailure: true
})
let automationLoadGeneration = 0

const onboardingPending = computed(() => Boolean(onboarding.value && !onboarding.value.completedAt && !onboarding.value.skippedAt))
const showWizard = computed(() => onboardingPending.value && automations.value.length === 0)
const showDeferredOnboarding = computed(() => onboardingPending.value && automations.value.length > 0)
const focusedAutomationId = computed(() => positiveId(route.query.automationId))

watch([focusedAutomationId, () => automations.value.map((item) => item.id).join(',')], () => {
  void focusAutomationSource()
})

async function load() {
  pageLoading.value = true
  loadError.value = ''
  try {
    const [catalog, state] = await Promise.all([listExperienceTemplates(), getOnboarding()])
    templates.value = catalog.data.items
    onboarding.value = state.data
    selectedProjectId.value = state.data.selectedProjectId ?? state.data.candidates?.projects?.[0]?.id
    selectedWorkspaceId.value = state.data.selectedWorkspaceId ?? state.data.candidates?.workspaces?.[0]?.id
    await loadAutomations()
  } catch (error: any) {
    loadError.value = requestMessage(error, '自动化数据加载失败，请确认 AI 服务可用后重试。')
  } finally {
    pageLoading.value = false
  }
}

async function loadAutomations() {
  const generation = ++automationLoadGeneration
  automationsError.value = ''
  try {
    const items = (await listAutomations()).data.items
    if (generation === automationLoadGeneration) automations.value = items
  } catch (error: any) {
    if (generation === automationLoadGeneration) {
      automationsError.value = requestMessage(error, '我的自动化加载失败，请稍后重试。')
    }
  }
}

function actionFor(id: number) {
  return automationActions.value[id] ?? null
}

function setAction(id: number, action?: AutomationAction) {
  automationActions.value = { ...automationActions.value, [id]: action }
}

async function runAutomation(item: AutomationSummary) {
  if (actionFor(item.id)) return
  setAction(item.id, 'run')
  feedback.value = ''
  try {
    await runAutomationRequest(item.id)
    trackAutomationAction('run', item.status)
    trackEffectiveProgress('automation_run', 'accepted', automationProjectId(item))
    feedback.value = `“${item.name}”已运行一次，结果将在执行中心展示。`
    await loadAutomations()
  } catch (error: any) {
    feedback.value = requestMessage(error, '自动化运行失败，请稍后重试。')
  } finally {
    setAction(item.id)
  }
}

async function toggleAutomation(item: AutomationSummary) {
  if (actionFor(item.id)) return
  setAction(item.id, 'toggle')
  feedback.value = ''
  try {
    if (item.status === 'enabled') await pauseAutomation(item.id)
    else {
      await enableAutomation(item.id)
      trackEffectiveProgress('automation_enable', 'enabled', automationProjectId(item))
    }
    trackAutomationAction(item.status === 'enabled' ? 'pause' : 'resume', item.status === 'enabled' ? 'paused' : 'enabled')
    feedback.value = `“${item.name}”已${item.status === 'enabled' ? '暂停' : '恢复'}。`
    await loadAutomations()
  } catch (error: any) {
    feedback.value = requestMessage(error, '自动化状态更新失败，请稍后重试。')
  } finally {
    setAction(item.id)
  }
}

function requestDelete(item: AutomationSummary) {
  if (actionFor(item.id)) return
  pendingDelete.value = item
}

async function confirmDeleteAutomation() {
  const item = pendingDelete.value
  if (!item || actionFor(item.id)) return
  setAction(item.id, 'delete')
  feedback.value = ''
  try {
    await deleteAutomation(item.id)
    trackAutomationAction('delete', 'deleted')
    feedback.value = `“${item.name}”已删除。`
    pendingDelete.value = null
    await loadAutomations()
  } catch (error: any) {
    feedback.value = requestMessage(error, '自动化删除失败，请稍后重试。')
  } finally {
    setAction(item.id)
  }
}

function openSettings(item: AutomationSummary) {
  if (actionFor(item.id)) return
  editingAutomation.value = item
  editError.value = ''
  editForm.value = {
    name: item.name,
    triggerType: item.triggerType || 'schedule',
    scheduleExpr: item.scheduleExpr || '',
    timezone: item.timezone || 'Asia/Shanghai',
    status: item.status === 'enabled' ? 'enabled' : 'paused',
    inputJson: JSON.stringify(item.input || {}, null, 2),
    maxRetries: item.maxRetries ?? 0,
    retryDelaySeconds: item.retryDelaySeconds ?? 60,
    notifyOnFailure: item.notifyOnFailure ?? true
  }
}

async function saveSettings() {
  const item = editingAutomation.value
  if (!item || actionFor(item.id)) return
  editError.value = ''
  let input: Record<string, unknown>
  try {
    const parsed = JSON.parse(editForm.value.inputJson || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('输入必须是 JSON 对象')
    input = parsed as Record<string, unknown>
  } catch (error) {
    editError.value = error instanceof Error ? error.message : '输入与数据范围必须是有效 JSON 对象。'
    return
  }

  const payload: AutomationUpdatePayload = {
    name: editForm.value.name.trim(),
    triggerType: editForm.value.triggerType,
    scheduleExpr: editForm.value.triggerType === 'schedule' ? editForm.value.scheduleExpr.trim() || 'daily' : null,
    timezone: editForm.value.timezone.trim() || 'Asia/Shanghai',
    status: editForm.value.status,
    input,
    maxRetries: Math.max(0, Math.min(5, Number(editForm.value.maxRetries) || 0)),
    retryDelaySeconds: Math.max(10, Math.min(86400, Number(editForm.value.retryDelaySeconds) || 60)),
    notifyOnFailure: editForm.value.notifyOnFailure
  }
  if (!payload.name) {
    editError.value = '自动化名称不能为空。'
    return
  }

  setAction(item.id, 'edit')
  try {
    await updateAutomation(item.id, payload)
    trackAutomationAction('edit', payload.status)
    feedback.value = `“${payload.name}”设置已保存。`
    editingAutomation.value = null
    await loadAutomations()
  } catch (error: any) {
    editError.value = requestMessage(error, '自动化设置保存失败，请稍后重试。')
  } finally {
    setAction(item.id)
  }
}

async function firstRun() {
  if (loading.value) return
  loading.value = true
  feedback.value = ''
  try {
    await runFirstInspection({ projectId: selectedProjectId.value, workspaceId: selectedWorkspaceId.value })
    feedback.value = '首次项目巡检已完成，结果已进入执行中心。'
    await load()
  } catch (error: any) {
    feedback.value = requestMessage(error, '巡检未完成，请检查项目与工作区。')
  } finally {
    loading.value = false
  }
}

async function skip() {
  try {
    await updateOnboarding({ action: 'skip' })
    await load()
  } catch (error: any) {
    feedback.value = requestMessage(error, '暂时无法更新引导状态。')
  }
}

async function reopen() {
  try {
    await updateOnboarding({ action: 'reopen' })
    await load()
  } catch (error: any) {
    feedback.value = requestMessage(error, '暂时无法重新打开引导。')
  }
}

async function chooseTemplate(item: AutomationTemplate) {
  if (item.availability === 'coming_soon' || loading.value) return
  feedback.value = ''
  loading.value = true
  try {
    const response = await createDraftFromTemplate({
      templateId: item.id,
      projectId: selectedProjectId.value,
      workspaceId: selectedWorkspaceId.value
    })
    draft.value = response.data
  } catch (error: any) {
    feedback.value = requestMessage(error, '模板预览生成失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function parseIntent() {
  if (!intent.value.trim() || loading.value) return
  loading.value = true
  feedback.value = ''
  try {
    const response = await createDraftFromIntent({
      text: intent.value,
      projectId: selectedProjectId.value,
      workspaceId: selectedWorkspaceId.value
    })
    if (response.data.kind === 'draft') draft.value = response.data.draft || null
    else feedback.value = response.data.unsupportedReason || '暂时无法创建这个自动化。'
  } catch (error: any) {
    feedback.value = requestMessage(error, '自动化预览生成失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function enableDraft() {
  if (!draft.value || loading.value) return
  loading.value = true
  try {
    const response = await enableDraftRequest(draft.value.id)
    trackEffectiveProgress('automation_enable', 'enabled', positiveId(response.data.draft.projectId))
    draft.value = null
    feedback.value = `“${response.data.draft.title}”已启用。`
    await loadAutomations()
  } catch (error: any) {
    feedback.value = requestMessage(error, '自动化启用失败，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function closeDraft() {
  const current = draft.value
  draft.value = null
  if (!current) return
  try {
    await discardDraftRequest(current.id)
  } catch (error: any) {
    feedback.value = requestMessage(error, '草稿已关闭，但服务端暂时无法清理草稿。')
  }
}

function openAttention(item: AutomationSummary) {
  trackAutomationAction('attention', item.status)
  router.push({ path: '/execution-center', query: { view: 'attention', automationId: String(item.id) } })
}

function openResult(item: AutomationSummary) {
  if (!item.lastResultId) return
  trackAutomationAction('view_result', item.lastRunStatus || item.status)
  router.push({ path: '/execution-center', query: { view: 'results', resultId: String(item.lastResultId) } })
}

function trackAutomationAction(actionType: string, status?: string | null) {
  void trackProductEvent({
    eventType: 'automation_card_actioned',
    page: 'automations',
    actionType,
    status: status || undefined
  }).catch(() => undefined)
}

function trackEffectiveProgress(
  actionType: 'automation_enable' | 'automation_run',
  status: 'accepted' | 'enabled',
  projectId?: number | null
) {
  void trackEffectiveProgressAction({
    page: 'automations',
    actionType,
    status,
    ...(projectId ? { projectId } : {})
  }).catch(() => undefined)
}

function automationProjectId(item: AutomationSummary) {
  return positiveId(item.projectId ?? item.input?.projectId)
}

function positiveId(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function focusAutomationSource() {
  const id = focusedAutomationId.value
  if (!id) return
  await nextTick()
  const target = document.querySelector<HTMLElement>(`[data-automation-id="${id}"]`)
  if (!target) return
  target.scrollIntoView({ block: 'center', behavior: 'auto' })
  target.focus({ preventScroll: true })
}

function requestMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.response?.data?.detail || error?.message || fallback
}

onMounted(async () => {
  await load()
  const handoffId = typeof route.query.handoffId === 'string' ? route.query.handoffId : ''
  const handoff = handoffId ? workspace.consumeAutomationIntent(handoffId) : null
  if (handoffId) {
    const query = { ...route.query }
    delete query.handoffId
    await router.replace({ path: '/automations', query })
  }
  if (handoff?.intent) {
    intent.value = handoff.intent
    selectedProjectId.value = handoff.projectId ?? undefined
    await parseIntent()
  }
  await focusAutomationSource()
})
</script>

<template>
  <div class="automation-page">
    <PageHeader
      eyebrow="结果型自动化"
      title="自动化"
      description="说出想持续获得的结果，Lyle 会用安全模板帮你配置。"
    >
      <template #actions>
        <RouterLink class="secondary-link" to="/execution-center">查看执行结果</RouterLink>
      </template>
    </PageHeader>

    <LoadingState v-if="pageLoading" label="正在加载自动化" :cards="3" />
    <section v-else-if="loadError" class="load-error">
      <h2>自动化加载失败</h2>
      <ErrorState title="自动化加载失败" :message="loadError" @retry="load" />
    </section>
    <template v-else>
      <section v-if="showWizard" class="onboarding">
        <div>
          <span class="onboarding-label">首次成功 · 全程只读</span>
          <h2>先完成一次项目巡检</h2>
          <p>检查项目进展、逾期事项和工作区状态，不会修改文件或外部系统。</p>
        </div>
        <div class="onboarding-fields">
          <label>项目
            <select v-model="selectedProjectId">
              <option :value="undefined">暂不关联项目</option>
              <option v-for="item in onboarding?.candidates?.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label>已授权工作区
            <select v-model="selectedWorkspaceId">
              <option :value="undefined">仅检查项目数据</option>
              <option v-for="item in onboarding?.candidates?.workspaces" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
        </div>
        <div class="onboarding-actions">
          <AppButton :loading="loading" @click="firstRun">{{ loading ? '巡检中…' : '运行一次项目巡检' }}</AppButton>
          <AppButton variant="secondary" :disabled="loading" @click="skip">稍后设置</AppButton>
        </div>
      </section>

      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>

      <section class="automations-section">
        <div class="section-heading">
          <div><h2>我的自动化</h2><p>直接运行、暂停或调整常用设置；执行权限仍由已有工作流策略控制。</p></div>
          <RouterLink class="secondary-link" to="/advanced-settings?tab=automations">高级配置</RouterLink>
        </div>
        <ErrorState
          v-if="automationsError"
          title="我的自动化加载失败"
          :message="automationsError"
          @retry="loadAutomations"
        />
        <div v-else-if="automations.length" class="automation-grid">
          <AutomationCard
            v-for="item in automations"
            :key="item.id"
            :item="item"
            :action="actionFor(item.id)"
            :class="{ 'automation-card-source': focusedAutomationId === item.id }"
            :data-automation-id="item.id"
            :tabindex="focusedAutomationId === item.id ? -1 : undefined"
            @run="runAutomation"
            @toggle="toggleAutomation"
            @edit="openSettings"
            @delete="requestDelete"
            @attention="openAttention"
            @open-result="openResult"
          >
            <template #dialogs>
              <ConfirmActionDialog
                :open="pendingDelete?.id === item.id"
                title="删除自动化"
                :description="`删除“${item.name}”后将停止后续运行，历史执行结果仍会保留。`"
                confirm-label="确认删除"
                danger
                :busy="actionFor(item.id) === 'delete'"
                @update:open="(open) => { if (!open) pendingDelete = null }"
                @confirm="confirmDeleteAutomation"
              />
            </template>
          </AutomationCard>
        </div>
        <EmptyState
          v-else
          title="还没有启用的自动化"
          description="从下方模板选择一个，或用一句话创建。"
          compact
        />
      </section>

      <section v-if="showDeferredOnboarding" class="onboarding-complete">
        <span>首次项目巡检尚未完成，不影响现有自动化运行。</span>
        <AppButton variant="secondary" size="sm" @click="reopen">继续引导</AppButton>
      </section>

      <section class="intent-card">
        <div><h2>用一句话创建</h2><p>例如：每周五下午五点检查 Lyle 项目进展和逾期任务，生成周报。</p></div>
        <form class="intent-form" @submit.prevent="parseIntent">
          <input v-model="intent" placeholder="我想定期得到…" aria-label="自动化意图" />
          <AppButton type="submit" :loading="loading" :disabled="!intent.trim()">生成预览</AppButton>
        </form>
      </section>

      <section class="templates-section">
        <div class="section-heading"><div><h2>结果模板</h2><p>模板只生成经过审查的只读流程。</p></div></div>
        <div class="template-grid">
          <article v-for="item in templates" :key="item.id" class="template-card" :class="{ disabled: item.availability === 'coming_soon' }">
            <div class="template-meta"><span>{{ formatAutomationTemplateCategory(item.category) }}</span><span v-if="item.availability">即将支持</span></div>
            <h3>{{ item.name }}</h3>
            <p>{{ item.problem }}</p>
            <dl>
              <div><dt>会读取</dt><dd>{{ item.sources.join('、') }}</dd></div>
              <div><dt>产出</dt><dd>{{ item.output }}</dd></div>
              <div><dt>默认频率</dt><dd>{{ formatAutomationSchedule(item.defaultSchedule, 'Asia/Shanghai') }}</dd></div>
              <div><dt>预计耗时</dt><dd>{{ item.estimatedDuration }}</dd></div>
            </dl>
            <AppButton :disabled="Boolean(item.availability) || loading" @click="chooseTemplate(item)">使用此模板</AppButton>
          </article>
        </div>
      </section>
    </template>

    <DetailDrawer
      :open="Boolean(draft)"
      :title="draft?.title || '启用前预览'"
      description="确认启用前检查运行时间、数据范围和写操作边界。"
      @update:open="(open) => { if (!open) closeDraft() }"
    >
      <template v-if="draft">
        <div class="drawer-block"><strong>运行时间</strong><p>{{ formatAutomationSchedule(draft.schedule, draft.timezone) }}</p></div>
        <div class="drawer-block"><strong>会读取</strong><p>{{ draft.allowedSources.join('、') }}</p></div>
        <div class="drawer-block safe"><strong>权限与写操作</strong><p>{{ draft.riskSummary.message }}</p></div>
        <p class="drawer-note">启用后才会创建工作流与自动化；此预览不会执行任何操作。</p>
      </template>
      <template #footer>
        <AppButton v-if="draft" :loading="loading" @click="enableDraft">确认启用</AppButton>
        <AppButton variant="secondary" :disabled="loading" @click="closeDraft">取消</AppButton>
        <RouterLink class="secondary-link" to="/advanced-settings?tab=workflows">高级编辑</RouterLink>
      </template>
    </DetailDrawer>

    <DetailDrawer
      :open="Boolean(editingAutomation)"
      :title="editingAutomation ? `设置 · ${editingAutomation.name}` : '自动化设置'"
      description="调整现有自动化字段，不会修改连接凭据或扩大工具权限。"
      @update:open="(open) => { if (!open) editingAutomation = null }"
    >
      <form v-if="editingAutomation" id="automation-settings-form" class="settings-form" @submit.prevent="saveSettings">
        <label>名称<input v-model="editForm.name" required /></label>
        <label>触发方式
          <select v-model="editForm.triggerType">
            <option value="schedule">定时运行</option>
            <option value="project_stale">项目停滞</option>
            <option value="task_due">任务到期</option>
          </select>
        </label>
        <div v-if="editForm.triggerType === 'schedule'" class="schedule-summary">
          <strong>当前运行时间</strong>
          <span>{{ formatAutomationSchedule(editForm.scheduleExpr, editForm.timezone) }}</span>
        </div>
        <label>状态
          <select v-model="editForm.status"><option value="enabled">运行中</option><option value="paused">已暂停</option></select>
        </label>
        <label class="check-line"><input v-model="editForm.notifyOnFailure" type="checkbox" />失败时提醒我</label>
        <details class="advanced-schedule">
          <summary>高级执行设置</summary>
          <template v-if="editForm.triggerType === 'schedule'">
            <label>频率表达式<input v-model="editForm.scheduleExpr" placeholder="例如 daily:10:00" /></label>
            <label>时区<input v-model="editForm.timezone" /></label>
          </template>
          <label>输入与数据范围（JSON）
            <textarea v-model="editForm.inputJson" rows="8" spellcheck="false" />
            <small>只填写项目、任务等既有 ID 和参数，不要粘贴 Secret。</small>
          </label>
          <div class="settings-grid">
            <label>最大重试次数<input v-model.number="editForm.maxRetries" type="number" min="0" max="5" /></label>
            <label>重试间隔（秒）<input v-model.number="editForm.retryDelaySeconds" type="number" min="10" max="86400" /></label>
          </div>
          <small>这些字段用于特殊调度与故障恢复；普通用户可以保留当前设置。</small>
        </details>
        <p class="permission-note">工具权限、工作区范围与二次确认规则继续由关联工作流和连接策略控制。</p>
        <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
      </form>
      <template #footer>
        <AppButton
          v-if="editingAutomation"
          type="submit"
          form="automation-settings-form"
          :loading="actionFor(editingAutomation.id) === 'edit'"
        >保存设置</AppButton>
        <AppButton variant="secondary" :disabled="Boolean(editingAutomation && actionFor(editingAutomation.id) === 'edit')" @click="editingAutomation = null">取消</AppButton>
      </template>
    </DetailDrawer>
  </div>
</template>

<style scoped>
.automation-page { display: grid; gap: var(--space-6); width: min(100%, 1180px); margin: 0 auto; }
.secondary-link { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 9px 14px; font-weight: 650; }
.secondary-link:hover { background: var(--surface-muted); }
.schedule-summary { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-3); }
.schedule-summary span { color: var(--muted-foreground); }
.advanced-schedule { display: grid; gap: var(--space-3); border-top: 1px solid var(--border); padding-top: var(--space-3); }
.advanced-schedule summary { cursor: pointer; font-weight: 700; }
.advanced-schedule[open] summary { margin-bottom: var(--space-3); }
.advanced-schedule label, .advanced-schedule .settings-grid { margin-bottom: var(--space-3); }
.load-error { display: grid; gap: var(--space-3); }.load-error > h2 { margin: 0; color: var(--danger-strong); font-size: 20px; }
.onboarding { display: grid; gap: var(--space-5); border-radius: var(--radius-xl); background: linear-gradient(135deg, var(--primary-hover), var(--primary)); color: var(--primary-foreground); padding: clamp(var(--space-5), 4vw, var(--space-8)); box-shadow: var(--shadow-card); }
.onboarding-label { display: inline-flex; border-radius: 999px; background: rgb(255 255 255 / .16); padding: 5px 9px; font-size: 12px; font-weight: 750; }
.onboarding h2 { margin: var(--space-3) 0 6px; font-size: clamp(23px, 3vw, 30px); }.onboarding p { margin: 0; color: rgb(255 255 255 / .82); }
.onboarding-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.onboarding-fields label { display: grid; gap: 6px; font-size: 13px; font-weight: 650; }.onboarding-fields select { background: var(--surface); color: var(--foreground); }
.onboarding-actions, .intent-form { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.onboarding-complete { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--info-border); border-radius: var(--radius-lg); background: var(--info-soft); padding: var(--space-3) var(--space-4); }
.feedback { margin: 0; border: 1px solid var(--success-border); border-radius: var(--radius-md); background: var(--success-soft); color: var(--success-strong); padding: var(--space-3) var(--space-4); }
.intent-card { display: grid; grid-template-columns: minmax(0, .8fr) minmax(280px, 1.2fr); align-items: end; gap: var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: var(--space-5); }
.intent-card h2, .section-heading h2 { margin: 0; color: var(--foreground); }.intent-card p, .section-heading p { margin: 5px 0 0; color: var(--muted-foreground); }
.intent-form input { flex: 1 1 220px; }
.automations-section, .templates-section { display: grid; gap: var(--space-4); }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); }
.automation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.automation-card-source { border-color: var(--primary-border); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent), var(--shadow-card); }
.template-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.template-card { display: grid; min-width: 0; grid-template-rows: auto auto auto 1fr auto; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: var(--space-5); }
.template-card.disabled { opacity: .62; }.template-meta { display: flex; justify-content: space-between; gap: var(--space-2); color: var(--muted-foreground); font-size: 12px; }.template-card h3 { margin: 0; font-size: 18px; }.template-card > p { margin: 0; color: var(--muted-foreground); line-height: 1.55; }
.template-card dl { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr); align-content: start; gap: var(--space-2); margin: 0; }.template-card dl > div { display: grid; min-width: 0; grid-template-columns: 76px minmax(0, 1fr); gap: var(--space-2); }.template-card dt { color: var(--muted-foreground); font-size: 13px; }.template-card dd { min-width: 0; margin: 0; font-size: 13px; overflow-wrap: break-word; word-break: normal; }
.drawer-block { display: grid; gap: 5px; border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-4); }.drawer-block + .drawer-block { margin-top: var(--space-3); }.drawer-block p, .drawer-note { margin: 0; color: var(--muted-foreground); line-height: 1.55; }.drawer-block.safe { border: 1px solid var(--success-border); background: var(--success-soft); }.drawer-block.safe p { color: var(--success-strong); }.drawer-note { margin-top: var(--space-4); }
.settings-form { display: grid; gap: var(--space-4); }.settings-form > label, .settings-grid label { display: grid; gap: 6px; color: var(--foreground); font-size: 13px; font-weight: 650; }.settings-form small { color: var(--muted-foreground); font-weight: 400; }.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }.check-line { display: flex !important; grid-template-columns: none; align-items: center; }.check-line input { width: auto; }.permission-note { margin: 0; border-radius: var(--radius-md); background: var(--info-soft); color: var(--info-strong); padding: var(--space-3); line-height: 1.5; }.form-error { margin: 0; color: var(--danger-strong); font-weight: 650; }
@media (max-width: 1280px) { .template-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) {
  .onboarding-fields, .automation-grid, .template-grid, .intent-card, .settings-grid { grid-template-columns: 1fr; }
  .section-heading, .onboarding-complete { align-items: stretch; flex-direction: column; }
  .secondary-link { width: 100%; }
  .intent-form :deep(button), .onboarding-actions :deep(button) { flex: 1 1 100%; }
}
</style>
