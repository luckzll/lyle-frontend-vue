<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  cancelAgentPlan,
  confirmAgentPlan,
  createAgentPlan,
  createAgentTodo,
  createProject,
  createProjectLink,
  createGoal,
  createMilestone,
  deleteProjectLink,
  getProjectOverview,
  listAgentPlans,
  listGoals,
  listProjects,
  pauseAgentPlan,
  resumeAgentPlan,
  updateGoal,
  updateProject
} from '@/api/app'
import type { AgentPlan, Goal, Project, ProjectOverview } from '@/api/types'

type ProjectSuggestion = {
  id: string
  group: '立即可做' | '本周推进' | '需要确认' | '项目健康'
  title: string
  detail: string
  tone?: 'normal' | 'pending' | 'danger' | 'success'
  actionLabel?: string
  action: () => Promise<void> | void
}

const route = useRoute()
const router = useRouter()
const projects = ref<Project[]>([])
const overview = ref<ProjectOverview | null>(null)
const goals = ref<Goal[]>([])
const plans = ref<AgentPlan[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const activeTab = ref<'overview' | 'goals' | 'plans' | 'links'>('overview')
const projectForm = ref({
  name: '',
  description: '',
  currentStage: '',
  priority: 0
})
const editForm = ref({
  description: '',
  currentStage: '',
  priority: 0
})
const linkForm = ref({
  targetType: 'todo',
  targetId: '',
  relation: 'related',
  confidence: 0.8
})
const goalForm = ref({
  title: '',
  description: '',
  horizon: 'week',
  dueAt: ''
})
const milestoneForms = ref<Record<number, { title: string; description: string; dueAt: string }>>({})

const selectedProjectId = computed(() => {
  const value = route.params.projectId
  const text = Array.isArray(value) ? value[0] : value
  const id = Number(text)
  return Number.isFinite(id) && id > 0 ? id : null
})
const selectedProject = computed(() => overview.value?.project ?? projects.value.find((item) => item.id === selectedProjectId.value))
const linkTypeItems = computed(() => Object.entries(overview.value?.linkCounts ?? {}))
const activeGoals = computed(() => goals.value.filter((item) => item.status === 'active'))
const averageProgress = computed(() => {
  if (!activeGoals.value.length) return 0
  return Math.round(activeGoals.value.reduce((sum, item) => sum + Number(item.progress || 0), 0) / activeGoals.value.length * 100)
})
const projectHealthItems = computed(() => buildProjectHealthItems())
const projectHealthScore = computed(() => {
  const items = projectHealthItems.value
  if (!items.length) return 0
  return Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length)
})
const groupedProjectSuggestions = computed(() => {
  const groups: Array<ProjectSuggestion['group']> = ['立即可做', '本周推进', '需要确认', '项目健康']
  const suggestions = buildProjectSuggestions()
  return groups
    .map((group) => ({
      group,
      items: suggestions.filter((item) => item.group === group)
    }))
    .filter((group) => group.items.length > 0)
})

watch(() => route.params.projectId, () => {
  loadOverview()
})

onMounted(refresh)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await listProjects()
    projects.value = response.data.items
    if (!selectedProjectId.value && projects.value.length > 0) {
      await router.replace(`/projects/${projects.value[0].id}`)
      return
    }
    await loadOverview()
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : '项目加载失败'
  } finally {
    loading.value = false
  }
}

async function loadOverview() {
  if (!selectedProjectId.value) {
    overview.value = null
    goals.value = []
    plans.value = []
    return
  }
  const response = await getProjectOverview(selectedProjectId.value)
  overview.value = response.data
  editForm.value = {
    description: response.data.project.description ?? '',
    currentStage: response.data.project.currentStage ?? '',
    priority: response.data.project.priority ?? 0
  }
  await loadGoals()
  await loadPlans()
}

async function loadGoals() {
  if (!selectedProjectId.value) {
    goals.value = []
    return
  }
  const response = await listGoals(selectedProjectId.value, 'active')
  goals.value = response.data.items
}

async function loadPlans() {
  if (!selectedProjectId.value) {
    plans.value = []
    return
  }
  const response = await listAgentPlans(selectedProjectId.value, undefined, 50)
  plans.value = response.data.items
}

async function submitProject() {
  if (!projectForm.value.name.trim()) return
  saving.value = true
  try {
    const response = await createProject(projectForm.value)
    projectForm.value = { name: '', description: '', currentStage: '', priority: 0 }
    await refresh()
    await router.push(`/projects/${response.data.id}`)
  } finally {
    saving.value = false
  }
}

async function saveProject() {
  if (!selectedProjectId.value) return
  saving.value = true
  try {
    await updateProject(selectedProjectId.value, editForm.value)
    await refresh()
  } finally {
    saving.value = false
  }
}

async function archiveProject() {
  if (!selectedProjectId.value) return
  saving.value = true
  try {
    await updateProject(selectedProjectId.value, { status: 'archived' })
    await router.push('/projects')
    await refresh()
  } finally {
    saving.value = false
  }
}

async function addLink() {
  if (!selectedProjectId.value || !linkForm.value.targetId.trim()) return
  saving.value = true
  try {
    await createProjectLink(selectedProjectId.value, linkForm.value)
    linkForm.value.targetId = ''
    await loadOverview()
  } finally {
    saving.value = false
  }
}

async function removeLink(linkId: number) {
  if (!selectedProjectId.value) return
  await deleteProjectLink(selectedProjectId.value, linkId)
  await loadOverview()
}

async function submitGoal() {
  if (!selectedProjectId.value || !goalForm.value.title.trim()) return
  saving.value = true
  try {
    await createGoal({
      projectId: selectedProjectId.value,
      title: goalForm.value.title,
      description: goalForm.value.description,
      horizon: goalForm.value.horizon,
      dueAt: goalForm.value.dueAt ? new Date(goalForm.value.dueAt).toISOString() : null
    })
    goalForm.value = { title: '', description: '', horizon: 'week', dueAt: '' }
    activeTab.value = 'goals'
    await loadOverview()
  } finally {
    saving.value = false
  }
}

async function setGoalProgress(goal: Goal, progressPercent: number) {
  saving.value = true
  try {
    await updateGoal(goal.id, { progress: progressPercent / 100 })
    await loadGoals()
  } finally {
    saving.value = false
  }
}

async function completeGoal(goal: Goal) {
  saving.value = true
  try {
    await updateGoal(goal.id, { status: 'completed', progress: 1 })
    await loadGoals()
  } finally {
    saving.value = false
  }
}

async function addMilestone(goal: Goal) {
  const form = milestoneForm(goal.id)
  if (!form.title.trim()) return
  saving.value = true
  try {
    await createMilestone(goal.id, {
      title: form.title,
      description: form.description,
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      sortOrder: goal.milestones?.length ?? 0
    })
    milestoneForms.value[goal.id] = { title: '', description: '', dueAt: '' }
    await loadGoals()
  } finally {
    saving.value = false
  }
}

async function confirmPlan(plan: AgentPlan) {
  saving.value = true
  try {
    await confirmAgentPlan(plan.id)
    await loadPlans()
  } finally {
    saving.value = false
  }
}

async function pausePlan(plan: AgentPlan) {
  saving.value = true
  try {
    await pauseAgentPlan(plan.id)
    await loadPlans()
  } finally {
    saving.value = false
  }
}

async function resumePlan(plan: AgentPlan) {
  saving.value = true
  try {
    await resumeAgentPlan(plan.id)
    await loadPlans()
  } finally {
    saving.value = false
  }
}

async function cancelPlan(plan: AgentPlan) {
  saving.value = true
  try {
    await cancelAgentPlan(plan.id)
    await loadPlans()
  } finally {
    saving.value = false
  }
}

async function createNextActionTodo() {
  if (!selectedProjectId.value) return
  const goal = activeGoals.value[0]
  const title = goal ? `推进：${goal.title}` : `推进：${selectedProject.value?.name || '项目'}下一步`
  const dueAt = tomorrowAtNine().toISOString()
  saving.value = true
  try {
    const response = await createAgentTodo(title, dueAt)
    await createProjectLink(selectedProjectId.value, {
      targetType: 'todo',
      targetId: String(response.data.id),
      relation: 'next_action',
      confidence: 0.9
    })
    await loadOverview()
  } finally {
    saving.value = false
  }
}

async function createPlanFromActiveGoal() {
  if (!selectedProjectId.value) return
  const goal = activeGoals.value[0]
  const goalTitle = goal?.title || `${selectedProject.value?.name || '项目'}阶段目标`
  saving.value = true
  try {
    await createAgentPlan({
      projectId: selectedProjectId.value,
      title: `${goalTitle}推进计划`,
      objective: `围绕「${goalTitle}」拆解本周可执行推进计划。`,
      steps: [
        { title: '确认验收口径', description: '明确完成标准、关键指标和边界条件。' },
        { title: '拆出本周任务', description: '把目标拆成可执行待办，并识别依赖。' },
        { title: '推进首个行动', description: '先完成低风险、可立即开始的一步。' },
        { title: '复盘和更新项目页', description: '同步进展、风险和下一步建议。' }
      ]
    })
    activeTab.value = 'plans'
    await loadPlans()
    await loadOverview()
  } finally {
    saving.value = false
  }
}

async function openGoalCreation() {
  if (!selectedProject.value) return
  goalForm.value.title = goalForm.value.title || `${selectedProject.value.name}本周可验证目标`
  goalForm.value.description = goalForm.value.description || '补充一个可验收、可推进、可复盘的项目目标。'
  goalForm.value.horizon = 'week'
  activeTab.value = 'goals'
}

async function openProjectSettings() {
  activeTab.value = 'overview'
}

async function openLinksTab() {
  activeTab.value = 'links'
  await loadOverview()
}

async function openPlansTab() {
  activeTab.value = 'plans'
  await loadPlans()
}

function milestoneForm(goalId: number) {
  if (!milestoneForms.value[goalId]) {
    milestoneForms.value[goalId] = { title: '', description: '', dueAt: '' }
  }
  return milestoneForms.value[goalId]
}

function typeText(type: string) {
  const labels: Record<string, string> = {
    conversation: '会话',
    message: '消息',
    memory_fragment: '记忆',
    knowledge_file: '文件',
    knowledge_chunk: '知识片段',
    todo: '任务',
    calendar_event: '日历',
    goal: '目标',
    milestone: '里程碑',
    decision: '决策',
    open_question: '开放问题',
    agent_plan: '长任务计划'
  }
  return labels[type] ?? type
}

function horizonText(horizon: string) {
  return {
    day: '今日',
    week: '本周',
    month: '本月',
    quarter: '季度',
    long_term: '长期'
  }[horizon] ?? horizon
}

function percent(value: number) {
  return Math.round(Number(value || 0) * 100)
}

async function switchTab(tab: 'overview' | 'goals' | 'plans' | 'links') {
  activeTab.value = tab
  if (tab === 'goals') {
    await loadGoals()
  }
  if (tab === 'plans') {
    await loadPlans()
  }
  if (tab === 'overview' || tab === 'links') {
    await loadOverview()
  }
}

function planStatusText(status: string) {
  return {
    draft: '草稿',
    awaiting_confirmation: '待确认',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }[status] ?? status
}

function stepStatusText(status: string) {
  return {
    pending: '待执行',
    running: '执行中',
    awaiting_user: '待确认',
    completed: '已完成',
    failed: '失败',
    skipped: '跳过'
  }[status] ?? status
}

function tomorrowAtNine() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date
}

function buildProjectHealthItems() {
  const linkCounts = overview.value?.linkCounts ?? {}
  const openQuestionCount = overview.value?.openQuestions.length ?? 0
  const decisionCount = overview.value?.decisions.length ?? 0
  const planCount = plans.value.length
  return [
    {
      label: '目标清晰度',
      score: activeGoals.value.length > 0 ? 100 : 35,
      detail: activeGoals.value.length > 0 ? `${activeGoals.value.length} 个进行中目标` : '还没有进行中目标'
    },
    {
      label: '任务覆盖度',
      score: (linkCounts.todo ?? 0) > 0 ? 100 : 30,
      detail: (linkCounts.todo ?? 0) > 0 ? `${linkCounts.todo} 个关联任务` : '缺少承接目标的任务'
    },
    {
      label: '资料完整度',
      score: ((linkCounts.knowledge_file ?? 0) + (linkCounts.memory_fragment ?? 0)) > 0 ? 90 : 35,
      detail: ((linkCounts.knowledge_file ?? 0) + (linkCounts.memory_fragment ?? 0)) > 0 ? '已有资料或记忆来源' : '还没有资料来源'
    },
    {
      label: '决策沉淀度',
      score: decisionCount > 0 ? 90 : 40,
      detail: decisionCount > 0 ? `${decisionCount} 条关键决策` : '关键决策尚未沉淀'
    },
    {
      label: '计划推进度',
      score: planCount > 0 ? 85 : 35,
      detail: planCount > 0 ? `${planCount} 个长任务计划` : '还没有推进计划'
    },
    {
      label: '风险状态',
      score: openQuestionCount > 0 ? 55 : 90,
      detail: openQuestionCount > 0 ? `${openQuestionCount} 个开放问题` : '暂无开放问题'
    }
  ]
}

function buildProjectSuggestions(): ProjectSuggestion[] {
  const linkCounts = overview.value?.linkCounts ?? {}
  const openQuestion = overview.value?.openQuestions[0]
  const goal = activeGoals.value[0]
  const pendingPlan = plans.value.find((plan) => plan.status === 'awaiting_confirmation' || plan.status === 'draft')
  const suggestions: ProjectSuggestion[] = []

  if ((linkCounts.todo ?? 0) === 0) {
    suggestions.push({
      id: 'create-next-action-todo',
      group: '立即可做',
      title: goal ? `把「${goal.title}」转成下一步待办` : '创建一个项目下一步待办',
      detail: '让项目页能直接看到可执行动作，避免目标停在描述层。',
      actionLabel: '创建待办',
      action: createNextActionTodo
    })
  }
  if (openQuestion) {
    suggestions.push({
      id: `open-question-${openQuestion.id}`,
      group: '立即可做',
      title: `先关闭开放问题：${openQuestion.question}`,
      detail: '开放问题会阻塞后续计划，建议优先澄清或转成决策。',
      tone: 'pending',
      actionLabel: '查看关联',
      action: openLinksTab
    })
  }
  if (goal && plans.value.length === 0) {
    suggestions.push({
      id: 'create-plan-from-goal',
      group: '本周推进',
      title: `基于「${goal.title}」生成推进计划`,
      detail: '自动拆成验收、任务、执行、复盘四步，创建后可在计划页确认执行。',
      actionLabel: '生成计划',
      action: createPlanFromActiveGoal
    })
  }
  if (!goal) {
    suggestions.push({
      id: 'create-goal',
      group: '本周推进',
      title: '补一个本周可验证目标',
      detail: '目标清楚后，Lyle 才能持续给出下一步和复盘建议。',
      actionLabel: '填写目标',
      action: openGoalCreation
    })
  }
  if (pendingPlan) {
    suggestions.push({
      id: `confirm-plan-${pendingPlan.id}`,
      group: '需要确认',
      title: `确认计划：${pendingPlan.title}`,
      detail: '计划还在待确认状态，确认后才会进入执行流。',
      tone: 'pending',
      actionLabel: '打开计划',
      action: openPlansTab
    })
  }
  if (!selectedProject.value?.currentStage) {
    suggestions.push({
      id: 'project-stage',
      group: '项目健康',
      title: '补充当前阶段',
      detail: '例如“方案验证 / 开发联调 / 产品验收”，方便生成更贴近阶段的建议。',
      actionLabel: '编辑项目',
      action: openProjectSettings
    })
  }
  if ((linkCounts.knowledge_file ?? 0) === 0 && (linkCounts.memory_fragment ?? 0) === 0) {
    suggestions.push({
      id: 'project-source',
      group: '项目健康',
      title: '关联资料或方案文档',
      detail: '项目需要事实来源，后续计划和回答才不容易漂移。',
      actionLabel: '去关联',
      action: openLinksTab
    })
  }
  if ((overview.value?.decisions.length ?? 0) === 0) {
    suggestions.push({
      id: 'project-decision',
      group: '项目健康',
      title: '沉淀一个关键决策',
      detail: '把范围、优先级或验收口径记录下来，避免后续反复摇摆。',
      actionLabel: '去关联',
      action: openLinksTab
    })
  }

  return suggestions.slice(0, 8)
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>项目</h1>
        <p class="muted">把任务、记忆、文件和决策聚合到长期项目空间。</p>
      </div>
      <button :disabled="loading" type="button" @click="refresh">刷新</button>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>

    <div class="project-layout">
      <aside class="item project-sidebar">
        <div class="section-title">
          <h2>项目列表</h2>
          <span class="badge">{{ projects.length }}</span>
        </div>
        <div v-if="projects.length === 0" class="empty-state compact">
          <strong>暂无项目</strong>
          <span>创建第一个项目后，就能开始关联任务和资料。</span>
        </div>
        <RouterLink
          v-for="project in projects"
          :key="project.id"
          class="project-list-item"
          :to="`/projects/${project.id}`"
        >
          <strong>{{ project.name }}</strong>
          <span>{{ project.currentStage || '未设置阶段' }}</span>
        </RouterLink>

        <form class="stack" @submit.prevent="submitProject">
          <h2>新建项目</h2>
          <input v-model="projectForm.name" placeholder="项目名称" />
          <textarea v-model="projectForm.description" rows="3" placeholder="一句话定位" />
          <input v-model="projectForm.currentStage" placeholder="当前阶段" />
          <input v-model.number="projectForm.priority" type="number" placeholder="优先级" />
          <button :disabled="saving || !projectForm.name.trim()" type="submit">创建</button>
        </form>
      </aside>

      <main v-if="selectedProject" class="stack">
        <article class="item">
          <div class="section-title">
            <div>
              <h2>{{ selectedProject.name }}</h2>
              <p class="muted">{{ selectedProject.description || '还没有项目定位。' }}</p>
            </div>
            <span class="badge" :class="{ success: selectedProject.status === 'active' }">
              {{ selectedProject.status === 'active' ? '进行中' : '已归档' }}
            </span>
          </div>
          <div class="status-grid">
            <div>
              <span class="metric">{{ selectedProject.currentStage || '未设置' }}</span>
              <span class="muted">当前阶段</span>
            </div>
            <div>
              <span class="metric">{{ selectedProject.priority }}</span>
              <span class="muted">优先级</span>
            </div>
            <div>
              <span class="metric">{{ overview?.links.length ?? 0 }}</span>
              <span class="muted">近期关联</span>
            </div>
            <div>
              <span class="metric">{{ activeGoals.length }}</span>
              <span class="muted">进行中目标</span>
            </div>
            <div>
              <span class="metric">{{ averageProgress }}%</span>
              <span class="muted">目标平均进度</span>
            </div>
          </div>
        </article>

        <div class="segmented project-tabs">
          <button :class="{ active: activeTab === 'overview' }" type="button" @click="switchTab('overview')">总览</button>
          <button :class="{ active: activeTab === 'goals' }" type="button" @click="switchTab('goals')">目标</button>
          <button :class="{ active: activeTab === 'plans' }" type="button" @click="switchTab('plans')">计划</button>
          <button :class="{ active: activeTab === 'links' }" type="button" @click="switchTab('links')">关联</button>
        </div>

        <div v-if="activeTab === 'overview'" class="grid">
          <article class="item wide">
            <div class="section-title">
              <div>
                <h2>项目健康度</h2>
                <p class="muted">从目标、任务、资料、决策、计划和风险看当前推进状态。</p>
              </div>
              <span class="metric">{{ projectHealthScore }}%</span>
            </div>
            <div class="project-health-grid">
              <div v-for="item in projectHealthItems" :key="item.label" class="project-health-item">
                <div class="section-title">
                  <strong>{{ item.label }}</strong>
                  <span class="badge" :class="{ success: item.score >= 80, pending: item.score >= 50 && item.score < 80, danger: item.score < 50 }">
                    {{ item.score }}%
                  </span>
                </div>
                <div class="progress-bar"><i :style="{ width: `${item.score}%` }" /></div>
                <small class="memory-meta">{{ item.detail }}</small>
              </div>
            </div>
          </article>

          <article class="item">
            <h2>项目设置</h2>
            <div class="stack">
              <textarea v-model="editForm.description" rows="4" placeholder="项目定位" />
              <input v-model="editForm.currentStage" placeholder="当前阶段" />
              <input v-model.number="editForm.priority" type="number" placeholder="优先级" />
              <span class="row">
                <button :disabled="saving" type="button" @click="saveProject">保存</button>
                <button class="secondary" :disabled="saving" type="button" @click="archiveProject">归档</button>
              </span>
            </div>
          </article>

          <article class="item">
            <h2>下一步建议</h2>
            <div v-if="groupedProjectSuggestions.length" class="project-suggestion-groups">
              <section v-for="group in groupedProjectSuggestions" :key="group.group" class="project-suggestion-group">
                <div class="section-title">
                  <strong>{{ group.group }}</strong>
                  <span class="badge">{{ group.items.length }}</span>
                </div>
                <div v-for="suggestion in group.items" :key="suggestion.id" class="project-suggestion-card" :class="suggestion.tone">
                  <div>
                    <strong>{{ suggestion.title }}</strong>
                    <span>{{ suggestion.detail }}</span>
                  </div>
                  <button v-if="suggestion.actionLabel" class="inline secondary" :disabled="saving" type="button" @click="suggestion.action">
                    {{ suggestion.actionLabel }}
                  </button>
                </div>
              </section>
            </div>
            <div v-else-if="overview?.nextStepSuggestions.length" class="stack">
              <div v-for="suggestion in overview.nextStepSuggestions" :key="suggestion" class="brief-focus-item">
                <strong>{{ suggestion }}</strong>
              </div>
            </div>
            <p v-else class="muted">项目基础信息比较完整，可以继续推进目标拆解。</p>
          </article>
        </div>

        <div v-if="activeTab === 'goals'" class="grid">
          <article class="item">
            <h2>新建目标</h2>
            <form class="stack" @submit.prevent="submitGoal">
              <input v-model="goalForm.title" placeholder="目标标题" />
              <textarea v-model="goalForm.description" rows="3" placeholder="目标描述" />
              <select v-model="goalForm.horizon">
                <option value="day">今日</option>
                <option value="week">本周</option>
                <option value="month">本月</option>
                <option value="quarter">季度</option>
                <option value="long_term">长期</option>
              </select>
              <input v-model="goalForm.dueAt" type="datetime-local" />
              <button :disabled="saving || !goalForm.title.trim()" type="submit">创建目标</button>
            </form>
          </article>

          <article class="item">
            <div class="section-title">
              <h2>目标进展</h2>
              <span class="badge">{{ activeGoals.length }}</span>
            </div>
            <div v-if="activeGoals.length" class="stack">
              <div v-for="goal in activeGoals" :key="goal.id" class="goal-card">
                <div class="section-title">
                  <strong>{{ goal.title }}</strong>
                  <span class="badge">{{ horizonText(goal.horizon) }}</span>
                </div>
                <p class="muted">{{ goal.description || '暂无描述' }}</p>
                <div class="progress-bar"><i :style="{ width: `${percent(goal.progress)}%` }" /></div>
                <span class="row">
                  <small class="memory-meta">{{ percent(goal.progress) }}% · {{ goal.dueAt || '未设置截止时间' }}</small>
                  <button class="inline secondary" type="button" @click="setGoalProgress(goal, Math.min(100, percent(goal.progress) + 25))">+25%</button>
                  <button class="inline" type="button" @click="completeGoal(goal)">完成</button>
                </span>
                <div class="stack">
                  <small class="memory-meta">里程碑</small>
                  <div v-if="goal.milestones?.length" class="stack">
                    <div v-for="milestone in goal.milestones" :key="milestone.id" class="memory-row">
                      <strong>{{ milestone.title }}</strong>
                      <span>{{ milestone.status }} · {{ milestone.dueAt || '无截止时间' }}</span>
                    </div>
                  </div>
                  <p v-else class="muted">还没有里程碑。</p>
                  <form class="row milestone-form" @submit.prevent="addMilestone(goal)">
                    <input v-model="milestoneForm(goal.id).title" placeholder="添加里程碑" />
                    <input v-model="milestoneForm(goal.id).dueAt" type="datetime-local" />
                    <button :disabled="saving || !milestoneForm(goal.id).title.trim()" type="submit">添加</button>
                  </form>
                </div>
              </div>
            </div>
            <p v-else class="muted">还没有进行中的目标。</p>
          </article>
        </div>

        <div v-if="activeTab === 'plans'" class="grid">
          <article class="item wide">
            <div class="section-title">
              <h2>长任务计划</h2>
              <span class="badge">{{ plans.length }}</span>
            </div>
            <div v-if="plans.length" class="stack">
              <div v-for="plan in plans" :key="plan.id" class="goal-card">
                <div class="section-title">
                  <div>
                    <strong>{{ plan.title }}</strong>
                    <p class="muted">{{ plan.objective }}</p>
                  </div>
                  <span class="badge" :class="{ success: plan.status === 'completed', pending: plan.status === 'paused' || plan.status === 'awaiting_confirmation' }">
                    {{ planStatusText(plan.status) }}
                  </span>
                </div>
                <ol class="plan-step-preview">
                  <li v-for="step in plan.steps || []" :key="step.id">
                    <strong>{{ step.title }}</strong>
                    <span>{{ step.description || step.outputRef || '暂无说明' }}</span>
                    <small class="memory-meta">{{ stepStatusText(step.status) }}{{ step.errorMessage ? ` · ${step.errorMessage}` : '' }}</small>
                  </li>
                </ol>
                <span class="row">
                  <button v-if="plan.status === 'awaiting_confirmation' || plan.status === 'draft'" type="button" :disabled="saving" @click="confirmPlan(plan)">确认执行</button>
                  <button v-if="plan.status === 'running'" class="secondary" type="button" :disabled="saving" @click="pausePlan(plan)">暂停</button>
                  <button v-if="plan.status === 'paused'" type="button" :disabled="saving" @click="resumePlan(plan)">继续</button>
                  <button v-if="!['completed', 'cancelled'].includes(plan.status)" class="secondary danger" type="button" :disabled="saving" @click="cancelPlan(plan)">取消</button>
                </span>
              </div>
            </div>
            <p v-else class="muted">还没有长任务计划。可以在聊天中让 Lyle 整理方案、拆解任务或生成执行计划。</p>
          </article>
        </div>

        <div v-if="activeTab === 'links'" class="grid">
          <article class="item">
            <div class="section-title">
              <h2>关联统计</h2>
              <span class="badge">{{ overview?.links.length ?? 0 }} 条</span>
            </div>
            <p v-if="linkTypeItems.length === 0" class="muted">还没有关联对象。</p>
            <div v-for="[type, count] in linkTypeItems" :key="type" class="memory-row">
              <strong>{{ typeText(type) }}</strong>
              <span>{{ count }}</span>
            </div>
          </article>

          <article class="item">
            <h2>手动关联</h2>
            <form class="stack" @submit.prevent="addLink">
              <select v-model="linkForm.targetType">
                <option value="todo">任务</option>
                <option value="knowledge_file">文件</option>
                <option value="memory_fragment">记忆</option>
                <option value="conversation">会话</option>
                <option value="decision">决策</option>
                <option value="open_question">开放问题</option>
              </select>
              <input v-model="linkForm.targetId" placeholder="对象 ID" />
              <input v-model="linkForm.relation" placeholder="关系，例如 related" />
              <input v-model.number="linkForm.confidence" type="number" min="0" max="1" step="0.05" />
              <button :disabled="saving || !linkForm.targetId.trim()" type="submit">关联</button>
            </form>
          </article>
        </div>

        <article v-if="activeTab === 'links'" class="item">
          <div class="section-title">
            <h2>最近关联</h2>
            <span class="badge">{{ overview?.links.length ?? 0 }}</span>
          </div>
          <p v-if="!overview?.links.length" class="muted">还没有关联任务、文件或记忆。</p>
          <div v-for="link in overview?.links" :key="link.id" class="memory-row stacked">
            <strong>{{ typeText(link.targetType) }} · {{ link.targetId }}</strong>
            <span>{{ link.relation }} · 置信度 {{ link.confidence }}</span>
            <span class="row">
              <small class="memory-meta">{{ link.createdAt }}</small>
              <button class="inline danger" type="button" @click="removeLink(link.id)">移除</button>
            </span>
          </div>
        </article>
      </main>

      <main v-else class="empty-state">
        <strong>选择或创建一个项目</strong>
        <span>项目页会汇总目标、任务、文件、记忆、决策和开放问题。</span>
      </main>
    </div>
  </section>
</template>
