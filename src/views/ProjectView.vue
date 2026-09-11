<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderKanban, Plus, ArrowRight, MessageSquare, Target, Link2, Search, RefreshCw, Settings2, ChevronRight } from '@lucide/vue'
import {
  cancelAgentPlan,
  confirmAgentPlan,
  createAgentPlan,
  createWorkflowFromPlan,
  createAgentTodo,
  createProjectDecision,
  createProject,
  createProjectLink,
  createProjectOpenQuestion,
  createGoal,
  createMilestone,
  deleteProjectLink,
  generateDailyBriefing,
  generateEveningBriefing,
  generateWeeklyBriefing,
  getProjectOverview,
  getTodayBriefing,
  linkTaskToGoal,
  listAgentPlans,
  listAgentTodos,
  listAutomations,
  listExecutionResults,
  listGoals,
  listProjects,
  pauseAgentPlan,
  resumeAgentPlan,
  updateAgentTodoDueAt,
  updateAgentTodoStatus,
  updateGoal,
  updateProject,
  updateProjectOpenQuestion
} from '@/api/app'
import type { AgentPlan, AgentTodoItem, AutomationSummary, DailyBriefing, ExecutionResultSummary, Goal, Project, ProjectDecision, ProjectOpenQuestion, ProjectOverview } from '@/api/types'
import { useWorkspaceStore } from '@/stores/workspace'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import DetailDrawer from '@/components/layout/DetailDrawer.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import { formatAutomationSchedule } from '@/domain/automation-schedule'

type ProjectSuggestion = {
  id: string
  group: '立即可做' | '本周推进' | '需要确认' | '项目健康'
  title: string
  detail: string
  tone?: 'normal' | 'pending' | 'danger' | 'success'
  actionLabel?: string
  action: () => Promise<void> | void
}

type OverviewSectionKey = 'health' | 'actions' | 'briefing' | 'risk' | 'timeline' | 'suggestions' | 'settings'

type ProjectTimelineItem = {
  id: string
  title: string
  detail: string
  type: string
  at: string
}

const route = useRoute()
const router = useRouter()
const workspace = useWorkspaceStore()
const projects = ref<Project[]>([])
const projectSearch = ref('')
const projectStatus = ref<'active' | 'archived' | 'all'>('all')
const overview = ref<ProjectOverview | null>(null)
const goals = ref<Goal[]>([])
const plans = ref<AgentPlan[]>([])
const todos = ref<AgentTodoItem[]>([])
const projectBriefing = ref<DailyBriefing | null>(null)
const projectResults = ref<ExecutionResultSummary[]>([])
const projectAutomations = ref<AutomationSummary[]>([])
const projectActivityError = ref('')
const loading = ref(false)
const listLoaded = ref(false)
const overviewLoading = ref(false)
const overviewError = ref('')
const sourceErrors = ref({ goals: '', plans: '', todos: '', briefing: '', activity: '' })
type ProjectSource = keyof typeof sourceErrors.value
let listGeneration = 0
let overviewGeneration = 0
let briefingActionGeneration = 0
let projectCreationGeneration = 0
let detailProjectId: number | null = null
const sourceGenerations: Record<ProjectSource, number> = { goals: 0, plans: 0, todos: 0, briefing: 0, activity: 0 }
let creatorTrigger: HTMLElement | null = null
const saving = ref(false)
const showCreateProject = ref(false)
const projectNameInput = ref<HTMLInputElement | null>(null)
const goalTitleInput = ref<HTMLInputElement | null>(null)
const projectSettingsInput = ref<HTMLTextAreaElement | null>(null)
const projectCreateError = ref('')
const showMoreOverview = ref(false)
const briefingLoading = ref(false)
const error = ref('')
const actionError = ref('')
const notice = ref('')
const activeTab = ref<'overview' | 'goals' | 'plans' | 'links'>('overview')
const briefingMode = ref<'daily' | 'evening' | 'weekly'>('daily')
const overviewSections = ref<Record<OverviewSectionKey, boolean>>({
  health: false,
  actions: true,
  briefing: false,
  risk: true,
  timeline: false,
  suggestions: false,
  settings: false
})
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
const decisionForm = ref({
  title: '',
  content: ''
})
const questionForm = ref({
  question: ''
})

const selectedProjectId = computed(() => {
  const value = route.params.projectId
  const text = Array.isArray(value) ? value[0] : value
  const id = Number(text)
  return Number.isSafeInteger(id) && id > 0 ? id : null
})
const selectedProject = computed(() => overview.value?.project.id === selectedProjectId.value
  ? overview.value.project
  : projects.value.find((item) => item.id === selectedProjectId.value))
const detailReady = computed(() => Boolean(selectedProjectId.value && overview.value?.project.id === selectedProjectId.value && !overviewLoading.value && !overviewError.value))
const isProjectEmpty = computed(() => listLoaded.value && !error.value && !projects.value.length && !selectedProjectId.value)
const visibleProjects = computed(() => {
  const query = projectSearch.value.trim().toLocaleLowerCase()
  return projects.value.filter((project) => (projectStatus.value === 'all' || project.status === projectStatus.value)
    && (!query || `${project.name} ${project.description ?? ''}`.toLocaleLowerCase().includes(query)))
})
const linkTypeItems = computed(() => Object.entries(overview.value?.linkCounts ?? {}))
const activeGoals = computed(() => goals.value.filter((item) => item.status === 'active'))
const visibleActiveGoals = computed(() => dedupeGoals(activeGoals.value))
const duplicateGoalCount = computed(() => activeGoals.value.length - visibleActiveGoals.value.length)
const averageProgress = computed(() => {
  if (!visibleActiveGoals.value.length) return 0
  return Math.round(visibleActiveGoals.value.reduce((sum, item) => sum + Number(item.progress || 0), 0) / visibleActiveGoals.value.length * 100)
})
const projectAllTodos = computed(() => todos.value.filter((item) => todoBelongsToProject(item)))
const isFreshProject = computed(() => detailReady.value && Object.values(sourceErrors.value).every((message) => !message)
  && !goals.value.length && !plans.value.length && !projectAllTodos.value.length
  && !overview.value?.links.length && !overview.value?.decisions.length && !overview.value?.openQuestions.length
  && !projectResults.value.length && !projectAutomations.value.length)
const projectOpenTodos = computed(() => projectAllTodos.value.filter((item) => item.status === 'open'))
const overdueProjectTodos = computed(() => projectOpenTodos.value.filter((item) => isOverdueTodo(item)))
const projectTodos = computed(() => [...projectOpenTodos.value].sort((a, b) => {
  if (!a.dueAt && !b.dueAt) return a.id - b.id
  if (!a.dueAt) return 1
  if (!b.dueAt) return -1
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
}).slice(0, 8))
const nextProjectTodo = computed(() => {
  return [...projectTodos.value].sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.id - b.id
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  })[0]
})
const secondaryProjectTodos = computed(() => projectTodos.value.filter((item) => item.id !== nextProjectTodo.value?.id))
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
const projectRisks = computed(() => buildProjectRisks())
const projectTimeline = computed(() => buildProjectTimeline())

watch(() => route.params.projectId, () => {
  loadOverview()
})

watch(() => route.fullPath, () => {
  projectCreationGeneration += 1
}, { flush: 'sync' })

watch(() => route.query.create, (value) => {
  if (value === '1') openProjectCreator()
}, { immediate: true })

watch(showCreateProject, async (open) => {
  if (!open) return
  await nextTick()
  // The drawer also opens after nextTick; wait until its native dialog is open.
  await nextTick()
  projectNameInput.value?.focus()
}, { immediate: true })

onMounted(refresh)
onUnmounted(() => {
  listGeneration += 1
  overviewGeneration += 1
  projectCreationGeneration += 1
})

function requestError(exception: unknown, fallback: string) {
  const data = (exception as { response?: { data?: { detail?: string; message?: string } } })?.response?.data
  return data?.detail || data?.message || (exception instanceof Error ? exception.message : fallback)
}

function currentDetail(projectId: number, generation: number) {
  return selectedProjectId.value === projectId && overviewGeneration === generation
}

function currentSource(source: ProjectSource, request: number, projectId: number, generation: number) {
  return sourceGenerations[source] === request && currentDetail(projectId, generation)
}

function clearProjectDetail() {
  actionError.value = ''
  overview.value = null
  goals.value = []
  plans.value = []
  todos.value = []
  projectBriefing.value = null
  projectResults.value = []
  projectAutomations.value = []
  projectActivityError.value = ''
  sourceErrors.value = { goals: '', plans: '', todos: '', briefing: '', activity: '' }
  editForm.value = { description: '', currentStage: '', priority: 0 }
  linkForm.value = { targetType: 'todo', targetId: '', relation: 'related', confidence: 0.8 }
  goalForm.value = { title: '', description: '', horizon: 'week', dueAt: '' }
  milestoneForms.value = {}
  decisionForm.value = { title: '', content: '' }
  questionForm.value = { question: '' }
  briefingLoading.value = false
  briefingActionGeneration += 1
  notice.value = ''
}

async function refresh() {
  const generation = ++listGeneration
  const requestedProjectId = selectedProjectId.value
  loading.value = true
  error.value = ''
  try {
    const responses = await Promise.all([listProjects('active'), listProjects('archived')])
    if (generation !== listGeneration) return
    projects.value = [...new Map(responses.flatMap((response) => response.data.items).map((project) => [project.id, project])).values()]
    listLoaded.value = true
    const firstActiveProject = projects.value.find((project) => project.status === 'active')
    if (!selectedProjectId.value && firstActiveProject && !showCreateProject.value) {
      await router.replace({ path: `/projects/${firstActiveProject.id}`, query: route.query, hash: route.hash })
      return
    }
    if (selectedProjectId.value === requestedProjectId) await loadOverview()
  } catch (exception) {
    if (generation === listGeneration) error.value = requestError(exception, '项目加载失败，请重试。')
  } finally {
    if (generation === listGeneration) loading.value = false
  }
}

async function loadOverview() {
  const projectId = selectedProjectId.value
  const generation = ++overviewGeneration
  if (detailProjectId !== projectId) {
    clearProjectDetail()
    detailProjectId = projectId
  }
  overviewError.value = ''
  overviewLoading.value = Boolean(projectId)
  if (!projectId) return
  try {
    const response = await getProjectOverview(projectId)
    if (!currentDetail(projectId, generation)) return
    if (response.data.project.id !== projectId) throw new Error('项目资料不匹配，请重新加载。')
    const previousProject = overview.value?.project
    const keepSettingsDraft = previousProject?.id === projectId
      && (editForm.value.description !== (previousProject.description ?? '')
        || editForm.value.currentStage !== (previousProject.currentStage ?? '')
        || editForm.value.priority !== (previousProject.priority ?? 0))
    overview.value = response.data
    if (!keepSettingsDraft) {
      editForm.value = {
        description: response.data.project.description ?? '',
        currentStage: response.data.project.currentStage ?? '',
        priority: response.data.project.priority ?? 0
      }
    }
    await Promise.all([loadGoals(projectId, generation), loadPlans(projectId, generation), loadTodos(projectId, generation), loadProjectBriefing(projectId, generation), loadProjectActivity(projectId, generation)])
  } catch (exception) {
    if (currentDetail(projectId, generation)) overviewError.value = requestError(exception, '项目详情加载失败，请重试。')
  } finally {
    if (currentDetail(projectId, generation)) overviewLoading.value = false
  }
}

async function loadProjectActivity(projectId = selectedProjectId.value, generation = overviewGeneration) {
  if (!projectId || !currentDetail(projectId, generation)) return
  const request = ++sourceGenerations.activity
  const [resultResponse, automationResponse] = await Promise.allSettled([
    listExecutionResults({ projectId, limit: 5 }),
    listAutomations()
  ])
  if (!currentSource('activity', request, projectId, generation)) return
  projectResults.value = resultResponse.status === 'fulfilled' ? resultResponse.value.data.items.slice(0, 5) : []
  projectAutomations.value = automationResponse.status === 'fulfilled'
    ? automationResponse.value.data.items.filter((item) => Number(item.input?.projectId) === projectId).slice(0, 5)
    : []
  projectActivityError.value = resultResponse.status === 'rejected' || automationResponse.status === 'rejected'
    ? '部分近期结果或自动化暂时无法加载。' : ''
  sourceErrors.value.activity = projectActivityError.value
}

async function loadGoals(projectId = selectedProjectId.value, generation = overviewGeneration) {
  if (!projectId || !currentDetail(projectId, generation)) return
  const request = ++sourceGenerations.goals
  try {
    const response = await listGoals(projectId, 'active')
    if (!currentSource('goals', request, projectId, generation)) return
    goals.value = response.data.items
    sourceErrors.value.goals = ''
  } catch (exception) {
    if (currentSource('goals', request, projectId, generation)) sourceErrors.value.goals = requestError(exception, '目标加载失败，请重试。')
  }
}

async function loadPlans(projectId = selectedProjectId.value, generation = overviewGeneration) {
  if (!projectId || !currentDetail(projectId, generation)) return
  const request = ++sourceGenerations.plans
  try {
    const response = await listAgentPlans(projectId, undefined, 50)
    if (!currentSource('plans', request, projectId, generation)) return
    plans.value = response.data.items
    sourceErrors.value.plans = ''
  } catch (exception) {
    if (currentSource('plans', request, projectId, generation)) sourceErrors.value.plans = requestError(exception, '计划加载失败，请重试。')
  }
}

async function loadTodos(projectId = selectedProjectId.value, generation = overviewGeneration) {
  if (!projectId || !currentDetail(projectId, generation)) return
  const request = ++sourceGenerations.todos
  try {
    const response = await listAgentTodos(100)
    if (!currentSource('todos', request, projectId, generation)) return
    todos.value = response.data.items
    sourceErrors.value.todos = ''
  } catch (exception) {
    if (currentSource('todos', request, projectId, generation)) sourceErrors.value.todos = requestError(exception, '任务加载失败，请重试。')
  }
}

async function loadProjectBriefing(projectId = selectedProjectId.value, generation = overviewGeneration) {
  if (!projectId || !currentDetail(projectId, generation)) return
  const request = ++sourceGenerations.briefing
  try {
    const response = await getTodayBriefing(projectId)
    if (!currentSource('briefing', request, projectId, generation)) return
    if (response.data.projectId !== projectId) {
      projectBriefing.value = null
      throw new Error('暂时无法获取此项目的简报，请稍后重试。')
    }
    projectBriefing.value = response.data
    sourceErrors.value.briefing = ''
  } catch (exception) {
    if (currentSource('briefing', request, projectId, generation)) sourceErrors.value.briefing = requestError(exception, '简报加载失败，请重试。')
  }
}

async function generateProjectBriefing() {
  const projectId = selectedProjectId.value
  const generation = overviewGeneration
  if (!projectId || !detailReady.value || briefingLoading.value) return
  const actionGeneration = ++briefingActionGeneration
  const request = ++sourceGenerations.briefing
  briefingLoading.value = true
  actionError.value = ''
  try {
    const response = briefingMode.value === 'weekly'
      ? await generateWeeklyBriefing(projectId)
      : briefingMode.value === 'evening'
        ? await generateEveningBriefing(projectId)
        : await generateDailyBriefing(projectId)
    if (!currentSource('briefing', request, projectId, generation)) return
    if (response.data.projectId !== projectId) {
      projectBriefing.value = null
      throw new Error('暂时无法生成此项目的简报，请稍后重试。')
    }
    projectBriefing.value = response.data
    sourceErrors.value.briefing = ''
    showNotice('项目简报已生成')
  } catch (exception) {
    if (currentSource('briefing', request, projectId, generation)) actionError.value = requestError(exception, '项目简报生成失败，请重试。')
  } finally {
    if (actionGeneration === briefingActionGeneration) briefingLoading.value = false
  }
}

function openProjectCreator() {
  if (!showCreateProject.value) creatorTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  projectCreateError.value = ''
  showCreateProject.value = true
}

async function setProjectCreatorOpen(open: boolean) {
  if (saving.value) return
  if (open) { openProjectCreator(); return }
  showCreateProject.value = false
  if (route.query.create === '1') {
    const query = { ...route.query }
    delete query.create
    delete query.from
    delete query.templateId
    await router.replace({ path: route.path, query, hash: route.hash })
  }
  await nextTick()
  if (creatorTrigger?.isConnected) creatorTrigger.focus()
}

async function submitProject() {
  if (saving.value || !projectForm.value.name.trim()) return
  const generation = ++projectCreationGeneration
  const submissionPath = route.fullPath
  const isCurrentSubmission = () => generation === projectCreationGeneration && route.fullPath === submissionPath
  saving.value = true
  projectCreateError.value = ''
  const fromAutomations = route.query.from === 'automations'
  const templateId = typeof route.query.templateId === 'string' ? route.query.templateId : undefined
  try {
    const response = await createProject({ ...projectForm.value })
    if (!isCurrentSubmission()) return
    projectForm.value = { name: '', description: '', currentStage: '', priority: 0 }
    showCreateProject.value = false
    showNotice('项目已创建')
    if (fromAutomations) {
      await router.push({ path: '/automations', query: { projectId: String(response.data.id), ...(templateId ? { templateId } : {}) } })
      return
    }
    projects.value = [response.data, ...projects.value.filter((project) => project.id !== response.data.id)]
    await router.push(`/projects/${response.data.id}`)
  } catch (exception) {
    if (!isCurrentSubmission()) return
    const data = (exception as { response?: { data?: { detail?: string; message?: string } } })?.response?.data
    projectCreateError.value = data?.detail || data?.message || '项目创建失败，请稍后重试。'
  } finally {
    saving.value = false
  }
}

async function runProjectAction(action: (projectId: number, generation: number) => Promise<void>) {
  const projectId = selectedProjectId.value
  const generation = overviewGeneration
  if (!projectId || !detailReady.value || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    await action(projectId, generation)
  } catch (exception) {
    if (currentDetail(projectId, generation)) actionError.value = requestError(exception, '操作失败，请稍后重试。')
  } finally {
    saving.value = false
  }
}

async function saveProject() {
  await runProjectAction(async (projectId, generation) => {
    await updateProject(projectId, { ...editForm.value })
    if (!currentDetail(projectId, generation)) return
    showNotice('项目设置已保存')
    await refresh()
  })
}

async function archiveProject() {
  await runProjectAction(async (projectId, generation) => {
    await updateProject(projectId, { status: 'archived' })
    if (!currentDetail(projectId, generation)) return
    showNotice('项目已归档')
    await router.push('/projects')
    await refresh()
  })
}

async function addLink() {
  if (!linkForm.value.targetId.trim()) return
  await runProjectAction(async (projectId, generation) => {
    await createProjectLink(projectId, { ...linkForm.value })
    if (!currentDetail(projectId, generation)) return
    linkForm.value.targetId = ''
    showNotice('关联已添加')
    await loadOverview()
  })
}

async function removeLink(linkId: number) {
  if (!overview.value?.links.some((link) => link.id === linkId)) return
  await runProjectAction(async (projectId, generation) => {
    await deleteProjectLink(projectId, linkId)
    if (!currentDetail(projectId, generation)) return
    showNotice('关联已移除')
    await loadOverview()
  })
}

async function submitDecision() {
  if (!decisionForm.value.title.trim() || !decisionForm.value.content.trim()) return
  await runProjectAction(async (projectId, generation) => {
    await createProjectDecision(projectId, {
      title: decisionForm.value.title.trim(),
      content: decisionForm.value.content.trim(),
      sourceType: 'manual',
      sourceId: `project:${projectId}`
    })
    if (!currentDetail(projectId, generation)) return
    decisionForm.value = { title: '', content: '' }
    showNotice('关键决策已记录')
    await loadOverview()
  })
}

async function submitOpenQuestion() {
  if (!questionForm.value.question.trim()) return
  await runProjectAction(async (projectId, generation) => {
    await createProjectOpenQuestion(projectId, {
      question: questionForm.value.question.trim(),
      sourceType: 'manual',
      sourceId: `project:${projectId}`
    })
    if (!currentDetail(projectId, generation)) return
    questionForm.value = { question: '' }
    showNotice('开放问题已记录')
    await loadOverview()
  })
}

async function closeOpenQuestion(question: ProjectOpenQuestion) {
  if (!overview.value?.openQuestions.some((item) => item.id === question.id)) return
  await runProjectAction(async (projectId, generation) => {
    await updateProjectOpenQuestion(question.id, 'resolved')
    if (!currentDetail(projectId, generation)) return
    showNotice('开放问题已关闭')
    await loadOverview()
  })
}

async function submitGoal() {
  if (!goalForm.value.title.trim()) return
  await runProjectAction(async (projectId, generation) => {
    await createGoal({
      projectId,
      title: goalForm.value.title,
      description: goalForm.value.description,
      horizon: goalForm.value.horizon,
      dueAt: goalForm.value.dueAt ? new Date(goalForm.value.dueAt).toISOString() : null
    })
    if (!currentDetail(projectId, generation)) return
    goalForm.value = { title: '', description: '', horizon: 'week', dueAt: '' }
    activeTab.value = 'goals'
    showNotice('目标已创建')
    await loadOverview()
  })
}

async function setGoalProgress(goal: Goal, progressPercent: number) {
  if (!goals.value.some((item) => item.id === goal.id)) return
  await runProjectAction(async (projectId, generation) => {
    await updateGoal(goal.id, { progress: progressPercent / 100 })
    if (!currentDetail(projectId, generation)) return
    showNotice('目标进度已更新')
    await loadGoals(projectId, generation)
  })
}

async function completeGoal(goal: Goal) {
  if (!goals.value.some((item) => item.id === goal.id)) return
  await runProjectAction(async (projectId, generation) => {
    await updateGoal(goal.id, { status: 'completed', progress: 1 })
    if (!currentDetail(projectId, generation)) return
    showNotice('目标已完成')
    await loadGoals(projectId, generation)
  })
}

async function addMilestone(goal: Goal) {
  if (!goals.value.some((item) => item.id === goal.id)) return
  const form = { ...milestoneForm(goal.id) }
  if (!form.title.trim()) return
  await runProjectAction(async (projectId, generation) => {
    await createMilestone(goal.id, {
      title: form.title,
      description: form.description,
      dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      sortOrder: goal.milestones?.length ?? 0
    })
    if (!currentDetail(projectId, generation)) return
    milestoneForms.value[goal.id] = { title: '', description: '', dueAt: '' }
    showNotice('里程碑已添加')
    await loadGoals(projectId, generation)
  })
}

async function confirmPlan(plan: AgentPlan) {
  if (!plans.value.some((item) => item.id === plan.id)) return
  await runProjectAction(async (projectId, generation) => {
    await confirmAgentPlan(plan.id)
    if (!currentDetail(projectId, generation)) return
    showNotice('计划已确认执行')
    await loadPlans(projectId, generation)
  })
}

async function pausePlan(plan: AgentPlan) {
  if (!plans.value.some((item) => item.id === plan.id)) return
  await runProjectAction(async (projectId, generation) => {
    await pauseAgentPlan(plan.id)
    if (!currentDetail(projectId, generation)) return
    showNotice('计划已暂停')
    await loadPlans(projectId, generation)
  })
}

async function resumePlan(plan: AgentPlan) {
  if (!plans.value.some((item) => item.id === plan.id)) return
  await runProjectAction(async (projectId, generation) => {
    await resumeAgentPlan(plan.id)
    if (!currentDetail(projectId, generation)) return
    showNotice('计划已继续')
    await loadPlans(projectId, generation)
  })
}

async function cancelPlan(plan: AgentPlan) {
  if (!plans.value.some((item) => item.id === plan.id)) return
  await runProjectAction(async (projectId, generation) => {
    await cancelAgentPlan(plan.id)
    if (!currentDetail(projectId, generation)) return
    showNotice('计划已取消')
    await loadPlans(projectId, generation)
  })
}

async function savePlanAsWorkflow(plan: AgentPlan) {
  if (!plans.value.some((item) => item.id === plan.id)) return
  await runProjectAction(async (projectId, generation) => {
    await createWorkflowFromPlan(plan.id)
    if (currentDetail(projectId, generation)) showNotice('计划已保存，可前往自动化查看和运行')
  })
}

async function createNextActionTodo(goalOverride?: Goal) {
  if (goalOverride && !goals.value.some((item) => item.id === goalOverride.id)) return
  const goal = goalOverride ?? visibleActiveGoals.value[0]
  const title = goal ? `推进：${goal.title}` : `推进：${selectedProject.value?.name || '项目'}下一步`
  const dueAt = tomorrowAtNine().toISOString()
  await runProjectAction(async (projectId, generation) => {
    const response = await createAgentTodo(title, dueAt)
    if (goal) {
      await linkTaskToGoal(goal.id, String(response.data.id))
    }
    await createProjectLink(projectId, {
      targetType: 'todo',
      targetId: String(response.data.id),
      relation: goal ? `next_action:${goal.id}` : 'next_action',
      confidence: 0.9
    })
    if (!currentDetail(projectId, generation)) return
    showNotice('下一步待办已创建')
    await loadOverview()
  })
}

async function completeTodo(item: AgentTodoItem) {
  if (!projectAllTodos.value.some((todo) => todo.id === item.id)) return
  await runProjectAction(async (projectId, generation) => {
    await updateAgentTodoStatus(item.id, 'done')
    if (!currentDetail(projectId, generation)) return
    showNotice('任务已完成')
    await loadTodos(projectId, generation)
  })
}

async function postponeTodo(item: AgentTodoItem) {
  if (!projectAllTodos.value.some((todo) => todo.id === item.id)) return
  await runProjectAction(async (projectId, generation) => {
    await updateAgentTodoDueAt(item.id, tomorrowAtNine().toISOString())
    if (!currentDetail(projectId, generation)) return
    showNotice('任务已顺延到明天 9 点')
    await loadTodos(projectId, generation)
  })
}

async function createPlanFromActiveGoal(goalOverride?: Goal) {
  if (goalOverride && !goals.value.some((item) => item.id === goalOverride.id)) return
  const goal = goalOverride ?? visibleActiveGoals.value[0]
  const goalTitle = goal?.title || `${selectedProject.value?.name || '项目'}阶段目标`
  await runProjectAction(async (projectId, generation) => {
    const response = await createAgentPlan({
      projectId,
      title: `${goalTitle}推进计划`,
      objective: `围绕「${goalTitle}」拆解本周可执行推进计划。`,
      steps: [
        { title: '确认验收口径', description: '明确完成标准、关键指标和边界条件。' },
        { title: '拆出本周任务', description: '把目标拆成可执行待办，并识别依赖。' },
        { title: '推进首个行动', description: '先完成低风险、可立即开始的一步。' },
        { title: '复盘和更新项目页', description: '同步进展、风险和下一步建议。' }
      ]
    })
    await createProjectLink(projectId, {
      targetType: 'agent_plan',
      targetId: String(response.data.id),
      relation: goal ? `goal_plan:${goal.id}` : 'project_plan',
      confidence: 0.9
    })
    if (!currentDetail(projectId, generation)) return
    activeTab.value = 'plans'
    showNotice('推进计划已生成')
    await loadOverview()
  })
}

async function openGoalCreation() {
  if (!detailReady.value || !selectedProject.value) return
  goalForm.value.title = goalForm.value.title || `${selectedProject.value.name}本周可验证目标`
  goalForm.value.description = goalForm.value.description || '补充一个可验收、可推进、可复盘的项目目标。'
  goalForm.value.horizon = 'week'
  activeTab.value = 'goals'
  await nextTick()
  goalTitleInput.value?.focus()
}

async function openProjectSettings() {
  if (!detailReady.value) return
  activeTab.value = 'overview'
  showMoreOverview.value = true
  overviewSections.value.settings = true
  await nextTick()
  projectSettingsInput.value?.focus()
}

async function openLinksTab() {
  activeTab.value = 'links'
  await loadOverview()
}

async function openPlansTab() {
  activeTab.value = 'plans'
  await loadPlans()
}

function toggleOverviewSection(section: OverviewSectionKey) {
  overviewSections.value[section] = !overviewSections.value[section]
}

function sectionToggleText(section: OverviewSectionKey) {
  return overviewSections.value[section] ? '收起' : '展开'
}

function showNotice(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) {
      notice.value = ''
    }
  }, 2200)
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

function briefingModeText(mode: string) {
  return {
    daily: '今日重点',
    evening: '晚间复盘',
    weekly: '周复盘'
  }[mode] ?? mode
}

function tomorrowAtNine() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return date
}

function isOverdueTodo(item: AgentTodoItem) {
  return Boolean(item.dueAt) && new Date(item.dueAt as string).getTime() < Date.now()
}

function isToday(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

function formatTodoTime(value?: string | null) {
  if (!value) return '未设置截止时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatTimelineTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function projectLinksBy(type: string, relationPrefix?: string) {
  return (overview.value?.links || []).filter((link) => {
    if (link.targetType !== type) return false
    return relationPrefix ? link.relation.startsWith(relationPrefix) : true
  })
}

function normalizeTitle(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/^在.+?下新增一个目标[:：]/, '').toLowerCase()
}

function dedupeGoals(items: Goal[]) {
  const seen = new Set<string>()
  return items.filter((goal) => {
    const key = normalizeTitle(goal.title)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function todoBelongsToProject(item: AgentTodoItem) {
  const linkedTodoIds = new Set(projectLinksBy('todo').map((link) => link.targetId))
  if (linkedTodoIds.has(String(item.id))) return true
  const projectName = selectedProject.value?.name || ''
  if (projectName && item.title.includes(projectName)) return true
  const goalValues = (item.goalLinks || [])
    .filter((goal) => goal.schemaPath?.startsWith('goals.'))
    .map((goal) => String(goal.value || ''))
  const goalTitles = visibleActiveGoals.value.map((goal) => goal.title)
  const compareValues = [...goalValues, ...goalTitles]
  return compareValues.some((value) => value && (item.title.includes(value.slice(0, 12)) || value.includes(item.title.slice(0, 12))))
}

function todoBelongsToGoal(item: AgentTodoItem, goal: Goal) {
  const goalLinkHit = (item.goalLinks || []).some((link) => String(link.schemaPath || '').endsWith(`.${goal.id}`) || String(link.value || '').includes(goal.title))
  if (goalLinkHit) return true
  const explicitLinkHit = projectLinksBy('todo', 'next_action:')
    .some((link) => link.targetId === String(item.id) && link.relation === `next_action:${goal.id}`)
  if (explicitLinkHit) return true
  return textMatchesGoal(item.title, goal)
}

function planBelongsToGoal(plan: AgentPlan, goal: Goal) {
  const explicitLinkHit = projectLinksBy('agent_plan', 'goal_plan:')
    .some((link) => link.targetId === String(plan.id) && link.relation === `goal_plan:${goal.id}`)
  if (explicitLinkHit) return true
  return textMatchesGoal(`${plan.title} ${plan.objective}`, goal)
}

function textMatchesGoal(text: string, goal: Goal) {
  const normalized = text.toLowerCase()
  const title = goal.title.toLowerCase()
  if (title && normalized.includes(title)) return true
  const titleHead = title.slice(0, 12)
  if (titleHead.length >= 6 && normalized.includes(titleHead)) return true
  return Boolean(goal.description && normalized.includes(goal.description.toLowerCase().slice(0, 12)))
}

function goalTodos(goal: Goal) {
  return projectTodos.value.filter((item) => todoBelongsToGoal(item, goal))
}

function goalPlans(goal: Goal) {
  return plans.value.filter((plan) => planBelongsToGoal(plan, goal))
}

function goalNextTodo(goal: Goal) {
  return goalTodos(goal).sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.id - b.id
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  })[0]
}

function goalSupportText(goal: Goal) {
  const todoCount = goalTodos(goal).length
  const planCount = goalPlans(goal).length
  if (todoCount > 0 && planCount > 0) return `${todoCount} 个行动 · ${planCount} 个计划`
  if (todoCount > 0) return `${todoCount} 个行动承接`
  if (planCount > 0) return `${planCount} 个计划承接`
  return '还没有行动或计划承接'
}

function goalSupportTone(goal: Goal) {
  if (goalTodos(goal).length > 0 && goalPlans(goal).length > 0) return 'success'
  if (goalTodos(goal).length > 0 || goalPlans(goal).length > 0) return 'pending'
  return 'danger'
}

function buildProjectTimeline() {
  const items: ProjectTimelineItem[] = []
  visibleActiveGoals.value.forEach((goal) => {
    items.push({
      id: `goal-${goal.id}`,
      title: `目标：${goal.title}`,
      detail: `${horizonText(goal.horizon)} · ${percent(goal.progress)}%`,
      type: '目标',
      at: goal.updatedAt || goal.createdAt
    })
  })
  projectAllTodos.value.slice(0, 12).forEach((todo) => {
    items.push({
      id: `todo-${todo.id}`,
      title: `任务：${todo.title}`,
      detail: `${todo.status}${todo.dueAt ? ` · ${formatTodoTime(todo.dueAt)}` : ''}`,
      type: '任务',
      at: todo.updatedAt || todo.createdAt
    })
  })
  plans.value.forEach((plan) => {
    items.push({
      id: `plan-${plan.id}`,
      title: `计划：${plan.title}`,
      detail: planStatusText(plan.status),
      type: '计划',
      at: plan.updatedAt || plan.createdAt
    })
  })
  ;(overview.value?.decisions || []).forEach((decision) => {
    items.push({
      id: `decision-${decision.id}`,
      title: `决策：${decision.title}`,
      detail: decisionSummary(decision),
      type: '决策',
      at: decision.updatedAt || decision.createdAt
    })
  })
  ;(overview.value?.openQuestions || []).forEach((question) => {
    items.push({
      id: `question-${question.id}`,
      title: `问题：${question.question}`,
      detail: question.status,
      type: '问题',
      at: question.updatedAt || question.createdAt
    })
  })
  return items
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10)
}

function buildProjectRisks() {
  const risks: Array<{ id: string; title: string; detail: string; tone: 'danger' | 'pending' | 'normal' }> = []
  const linkCounts = overview.value?.linkCounts ?? {}
  if (overdueProjectTodos.value.length > 0) {
    risks.push({
      id: 'overdue-todo',
      title: `${overdueProjectTodos.value.length} 个项目任务已逾期`,
      detail: overdueProjectTodos.value[0].title,
      tone: 'danger'
    })
  }
  if ((overview.value?.openQuestions.length ?? 0) > 0) {
    risks.push({
      id: 'open-question',
      title: `${overview.value?.openQuestions.length ?? 0} 个开放问题待关闭`,
      detail: overview.value?.openQuestions[0]?.question || '建议先明确阻塞项。',
      tone: 'pending'
    })
  }
  if (visibleActiveGoals.value.some((goal) => goalTodos(goal).length === 0)) {
    risks.push({
      id: 'goal-without-action',
      title: '部分目标还没有行动承接',
      detail: '目标页可直接为对应目标创建待办或推进计划。',
      tone: 'pending'
    })
  }
  if ((overview.value?.decisions.length ?? 0) === 0) {
    risks.push({
      id: 'missing-decision',
      title: '还没有关键决策记录',
      detail: '建议记录验收口径、范围边界或优先级判断。',
      tone: 'normal'
    })
  }
  if ((linkCounts.knowledge_file ?? 0) === 0 && (linkCounts.memory_fragment ?? 0) === 0) {
    risks.push({
      id: 'missing-source',
      title: '项目缺少资料来源',
      detail: '关联资料或记忆后，计划和简报会更稳定。',
      tone: 'normal'
    })
  }
  return risks.slice(0, 5)
}

function decisionSummary(decision: ProjectDecision) {
  return decision.content.length > 96 ? `${decision.content.slice(0, 96)}...` : decision.content
}

function buildProjectHealthItems() {
  const linkCounts = overview.value?.linkCounts ?? {}
  const openQuestionCount = overview.value?.openQuestions.length ?? 0
  const decisionCount = overview.value?.decisions.length ?? 0
  const planCount = plans.value.length
  const actionCount = Math.max(linkCounts.todo ?? 0, projectTodos.value.length)
  return [
    {
      label: '目标清晰度',
      score: visibleActiveGoals.value.length > 0 ? 100 : 0,
      detail: visibleActiveGoals.value.length > 0 ? `${visibleActiveGoals.value.length} 个进行中目标` : '还没有进行中目标'
    },
    {
      label: '任务覆盖度',
      score: overdueProjectTodos.value.length > 0
        ? Math.max(0, 60 - overdueProjectTodos.value.length * 10)
        : actionCount > 0 ? 100 : 0,
      detail: actionCount > 0 ? `${actionCount} 个关联或匹配任务` : '缺少承接目标的任务'
    },
    {
      label: '资料完整度',
      score: ((linkCounts.knowledge_file ?? 0) + (linkCounts.memory_fragment ?? 0)) > 0 ? 100 : 0,
      detail: ((linkCounts.knowledge_file ?? 0) + (linkCounts.memory_fragment ?? 0)) > 0 ? '已有资料或记忆来源' : '还没有资料来源'
    },
    {
      label: '决策沉淀度',
      score: decisionCount > 0 ? 100 : 0,
      detail: decisionCount > 0 ? `${decisionCount} 条关键决策` : '关键决策尚未沉淀'
    },
    {
      label: '计划推进度',
      score: planCount > 0 ? 100 : 0,
      detail: planCount > 0 ? `${planCount} 个长任务计划` : '还没有推进计划'
    },
    {
      label: '风险状态',
      score: Math.max(0, 100 - openQuestionCount * 20 - overdueProjectTodos.value.length * 15),
      detail: openQuestionCount > 0 ? `${openQuestionCount} 个开放问题` : '暂无开放问题'
    }
  ]
}

function buildProjectSuggestions(): ProjectSuggestion[] {
  const linkCounts = overview.value?.linkCounts ?? {}
  const actionCount = Math.max(linkCounts.todo ?? 0, projectTodos.value.length)
  const openQuestion = overview.value?.openQuestions[0]
  const goal = visibleActiveGoals.value[0]
  const pendingPlan = plans.value.find((plan) => plan.status === 'awaiting_confirmation' || plan.status === 'draft')
  const suggestions: ProjectSuggestion[] = []

  if (actionCount === 0) {
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
  if (overdueProjectTodos.value.length > 0) {
    suggestions.unshift({
      id: 'overdue-project-todo',
      group: '立即可做',
      title: `先处理逾期任务：${overdueProjectTodos.value[0].title}`,
      detail: '这个任务已经超过截止时间，建议完成、顺延或取消。',
      tone: 'danger',
      actionLabel: '顺延到明天',
      action: () => postponeTodo(overdueProjectTodos.value[0])
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

async function openProjectChat() {
  const project = selectedProject.value
  if (!detailReady.value || !project) return
  workspace.stageChatDraft(
    `帮我基于「${project.name}」当前目标、任务和风险，明确最值得推进的下一步。`,
    { id: project.id, name: project.name },
    'project'
  )
  await router.push('/')
}
</script>

<template>
  <section class="page projects-page" :class="{ 'projects-page--empty': isProjectEmpty }">
    <header class="projects-header">
      <div :class="{ 'visually-hidden': isProjectEmpty }">
        <h1>项目</h1>
        <p>让目标、行动和资料，围绕同一件事有序推进。</p>
      </div>
      <div class="project-header-actions">
        <AppButton variant="ghost" :loading="loading" @click="refresh"><RefreshCw v-if="!loading" :size="16" aria-hidden="true" />刷新</AppButton>
        <AppButton v-if="!isProjectEmpty" @click="openProjectCreator"><Plus :size="17" aria-hidden="true" />新建项目</AppButton>
      </div>
    </header>

    <p v-if="error && projects.length" class="alert danger" role="alert">{{ error }}</p>
    <p v-if="actionError" class="alert danger" role="alert">{{ actionError }}</p>
    <p v-if="notice" class="project-notice" role="status">{{ notice }}</p>

    <LoadingState v-if="!listLoaded && loading" label="正在加载项目" :cards="2" />
    <ErrorState v-else-if="error && !projects.length" title="项目暂时无法加载" :message="error" :retrying="loading" @retry="refresh" />
    <template v-else-if="isProjectEmpty">
      <section class="projects-welcome" aria-labelledby="project-welcome-title">
        <span class="welcome-icon"><FolderKanban :size="40" :stroke-width="1.6" aria-hidden="true" /></span>
        <h2 id="project-welcome-title"><span>把一个想法，</span><span>变成一个项目</span></h2>
        <p>把目标、任务和资料放在一起，<br class="desktop-break" />让每一步推进都有上下文。</p>
        <div class="welcome-actions">
          <AppButton class="welcome-primary" @click="openProjectCreator"><Plus :size="19" aria-hidden="true" />创建第一个项目</AppButton>
          <RouterLink class="text-action" to="/">和 Lyle 梳理想法<ArrowRight :size="17" aria-hidden="true" /></RouterLink>
        </div>
      </section>
      <div class="project-capabilities">
        <article><span class="capability-icon"><Target :size="23" aria-hidden="true" /></span><div><h3>明确目标</h3><p>记下想达成的结果，拆解目标与里程碑。</p></div></article>
        <article><span class="capability-icon"><Link2 :size="23" aria-hidden="true" /></span><div><h3>组织资料</h3><p>关联任务、文件和记忆，保留完整的项目背景。</p></div></article>
        <article><span class="capability-icon"><MessageSquare :size="23" aria-hidden="true" /></span><div><h3>持续推进</h3><p>带着项目上下文对话，让 Lyle 帮你找到下一步。</p></div></article>
      </div>
    </template>
    <div v-else class="project-layout">
      <aside class="item project-sidebar">
        <div class="section-title">
          <h2>我的项目</h2><span class="project-count">{{ projects.length }}</span>
        </div>
        <label class="project-search"><Search :size="16" aria-hidden="true" /><input v-model="projectSearch" aria-label="搜索项目" placeholder="搜索项目" type="search" /></label>
        <select v-model="projectStatus" aria-label="项目状态"><option value="all">全部项目</option><option value="active">进行中</option><option value="archived">已归档</option></select>
        <nav class="project-list" aria-label="项目列表">
          <RouterLink v-for="project in visibleProjects" :key="project.id" class="project-list-item" :to="`/projects/${project.id}`" :aria-current="selectedProjectId === project.id ? 'page' : undefined">
            <FolderKanban :size="19" aria-hidden="true" />
            <span class="project-list-copy"><strong>{{ project.name }}</strong><small>{{ project.status === 'archived' ? '已归档' : project.currentStage || '进行中' }}</small></span>
            <ChevronRight :size="15" aria-hidden="true" />
          </RouterLink>
        </nav>
        <div v-if="!visibleProjects.length" class="project-filter-empty">
          <strong>没有匹配的项目</strong><p>试试其他关键词或项目状态。</p>
          <button class="text-action" type="button" @click="projectSearch = ''; projectStatus = 'all'">清除筛选</button>
        </div>
      </aside>

      <LoadingState v-if="overviewLoading" label="正在打开项目" :cards="2" />
      <ErrorState v-else-if="overviewError" title="项目详情暂时无法加载" :message="overviewError" @retry="loadOverview" />
      <section v-else-if="detailReady && selectedProject" class="stack project-detail" aria-label="项目详情">
        <article class="item project-detail-header">
          <div class="section-title">
            <div class="project-heading-copy">
              <div class="project-eyebrow"><FolderKanban :size="17" aria-hidden="true" /><span>{{ selectedProject.status === 'active' ? '进行中' : '已归档' }}</span><span v-if="selectedProject.currentStage">· {{ selectedProject.currentStage }}</span></div>
              <h2>{{ selectedProject.name }}</h2>
              <p class="muted">{{ selectedProject.description || '补充一句项目定位，让每次推进都更有方向。' }}</p>
            </div>
            <div class="project-detail-actions"><AppButton variant="secondary" @click="openProjectChat"><MessageSquare :size="16" aria-hidden="true" />在聊天中推进</AppButton><AppButton variant="ghost" size="icon" aria-label="编辑项目设置" @click="openProjectSettings"><Settings2 :size="18" aria-hidden="true" /></AppButton></div>
          </div>
          <div v-if="!isFreshProject" class="project-summary-strip" aria-label="项目摘要">
            <span><strong>{{ sourceErrors.goals ? '—' : visibleActiveGoals.length }}</strong>个进行中目标</span>
            <span :class="{ danger: overdueProjectTodos.length > 0 }"><strong>{{ sourceErrors.todos || sourceErrors.goals ? '—' : projectOpenTodos.length }}</strong>个待办行动<small v-if="overdueProjectTodos.length && !sourceErrors.todos && !sourceErrors.goals">{{ overdueProjectTodos.length }} 个逾期</small></span>
            <span><strong>{{ sourceErrors.activity ? '—' : projectResults.length }}</strong>个近期结果</span>
          </div>
        </article>

        <div class="project-tabs" role="group" aria-label="项目内容">
          <button :class="{ active: activeTab === 'overview' }" :aria-pressed="activeTab === 'overview'" type="button" @click="switchTab('overview')">总览</button>
          <button :class="{ active: activeTab === 'goals' }" :aria-pressed="activeTab === 'goals'" type="button" @click="switchTab('goals')">目标</button>
          <button :class="{ active: activeTab === 'plans' }" :aria-pressed="activeTab === 'plans'" type="button" @click="switchTab('plans')">计划</button>
          <button :class="{ active: activeTab === 'links' }" :aria-pressed="activeTab === 'links'" type="button" @click="switchTab('links')">关联</button>
        </div>

        <div v-if="activeTab === 'overview'" class="grid project-overview-grid">
          <section v-if="isFreshProject" class="item wide project-starter" aria-labelledby="project-starter-title">
            <h2 id="project-starter-title">项目已就位，从下一步开始</h2><p>先确定一个小目标，或和 Lyle 一起梳理想法。</p>
            <div class="project-starter-actions">
              <button type="button" @click="openGoalCreation"><Target :size="23" aria-hidden="true" /><strong>明确第一个目标</strong><span>定义想达成的结果</span><ArrowRight :size="17" aria-hidden="true" /></button>
              <button type="button" @click="openProjectChat"><MessageSquare :size="23" aria-hidden="true" /><strong>一起梳理行动</strong><span>和 Lyle 拆解下一步</span><ArrowRight :size="17" aria-hidden="true" /></button>
              <button type="button" @click="openLinksTab"><Link2 :size="23" aria-hidden="true" /><strong>关联已有资料</strong><span>汇集相关任务和文件</span><ArrowRight :size="17" aria-hidden="true" /></button>
            </div>
            <button v-if="projectBriefing?.content" class="text-action starter-briefing" type="button" @click="showMoreOverview = !showMoreOverview; overviewSections.briefing = true">{{ showMoreOverview ? '收起项目简报' : '查看项目简报' }}<ArrowRight :size="16" aria-hidden="true" /></button>
          </section>
          <div v-if="Object.values(sourceErrors).some(Boolean)" class="wide project-source-warning" role="status"><div><strong>部分项目信息暂时无法加载</strong><p>已加载的内容仍可查看，缺失数据不会计入项目判断。</p></div><AppButton variant="secondary" @click="loadOverview">重新加载</AppButton></div>
          <article v-if="showMoreOverview && !isFreshProject && !Object.values(sourceErrors).some(Boolean)" class="item wide collapsible-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>项目健康度</h2>
                <p class="muted">从目标、任务、资料、决策、计划和风险看当前推进状态。</p>
              </div>
              <span class="row">
                <span v-if="duplicateGoalCount > 0" class="badge pending">已隐藏 {{ duplicateGoalCount }} 个重复目标</span>
                <span class="metric">{{ projectHealthScore }}%</span>
                <button class="inline secondary" type="button" @click="toggleOverviewSection('health')">{{ sectionToggleText('health') }}</button>
              </span>
            </div>
            <div v-if="overviewSections.health" class="project-health-grid">
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

          <article v-if="!isFreshProject" class="item wide collapsible-section priority-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>本周行动</h2>
                <p class="muted">从任务和目标关联里聚合出的项目下一步。</p>
              </div>
              <span class="row">
                <span v-if="!sourceErrors.todos && !sourceErrors.goals" class="badge" :class="{ danger: overdueProjectTodos.length > 0, success: projectTodos.length > 0 && overdueProjectTodos.length === 0 }">
                  {{ overdueProjectTodos.length > 0 ? `${overdueProjectTodos.length} 个逾期` : `${projectOpenTodos.length} 个任务` }}
                </span>
                <button class="inline secondary" type="button" @click="toggleOverviewSection('actions')">{{ sectionToggleText('actions') }}</button>
              </span>
            </div>
            <div v-if="overviewSections.actions">
              <ErrorState v-if="sourceErrors.todos || sourceErrors.goals" title="项目行动暂时无法加载" :message="sourceErrors.todos || sourceErrors.goals" @retry="loadOverview" />
              <div v-else-if="projectTodos.length" class="stack">
                <div v-if="nextProjectTodo" class="project-next-action">
                  <small class="memory-meta">优先行动</small>
                  <strong>{{ nextProjectTodo.title }}</strong>
                  <span>{{ formatTodoTime(nextProjectTodo.dueAt) }}</span>
                  <span class="row">
                    <button class="inline secondary" :disabled="saving" type="button" @click="postponeTodo(nextProjectTodo)">明天 9 点</button>
                    <button class="inline" :disabled="saving" type="button" @click="completeTodo(nextProjectTodo)">完成</button>
                  </span>
                </div>
                <div v-for="item in secondaryProjectTodos" :key="item.id" class="project-action-row" :class="{ danger: isOverdueTodo(item), pending: isToday(item.dueAt) }">
                  <div>
                    <strong>{{ item.title }}</strong>
                    <span>{{ formatTodoTime(item.dueAt) }}</span>
                  </div>
                  <span class="row">
                    <button class="inline secondary" :disabled="saving" type="button" @click="postponeTodo(item)">明天 9 点</button>
                    <button class="inline" :disabled="saving" type="button" @click="completeTodo(item)">完成</button>
                  </span>
                </div>
              </div>
              <div v-else class="empty-state compact">
                <strong>还没有项目行动</strong>
                <span>可以在任务页创建下一步，或直接让 Lyle 在聊天中拆解行动。</span>
                <button class="text-action" type="button" @click="openProjectChat">和 Lyle 拆解行动<ArrowRight :size="16" aria-hidden="true" /></button>
              </div>
            </div>
          </article>

          <article v-if="!isFreshProject" class="item wide project-activity-section">
            <div class="section-title">
              <div>
                <h2>近期结果与自动化</h2>
                <p class="muted">围绕当前项目发生的执行结果和持续工作。</p>
              </div>
              <RouterLink class="button-link" :to="{ path: '/execution-center', query: { view: 'results', projectId: selectedProjectId } }">查看全部结果</RouterLink>
            </div>
            <ErrorState v-if="sourceErrors.activity" title="近期结果与自动化暂时无法加载" :message="sourceErrors.activity" @retry="loadOverview" />
            <div v-else class="project-activity-grid">
              <section>
                <div class="section-title"><strong>近期结果</strong><span class="badge">{{ projectResults.length }}</span></div>
                <RouterLink
                  v-for="result in projectResults.slice(0, 3)"
                  :key="result.id"
                  class="project-linked-item"
                  :to="{ path: '/execution-center', query: { view: 'results', resultId: result.id } }"
                >
                  <span><strong>{{ result.title }}</strong><small>{{ result.conclusion }}</small></span>
                  <StatusBadge :status="result.status" />
                </RouterLink>
                <p v-if="!projectResults.length" class="muted">暂无项目执行结果。</p>
              </section>
              <section>
                <div class="section-title"><strong>关联自动化</strong><span class="badge">{{ projectAutomations.length }}</span></div>
                <RouterLink v-for="automation in projectAutomations.slice(0, 3)" :key="automation.id" class="project-linked-item" to="/automations">
                  <span><strong>{{ automation.name }}</strong><small>{{ automation.triggerType === 'schedule' ? formatAutomationSchedule(automation.scheduleExpr, automation.timezone) : '事件触发' }}</small></span>
                  <StatusBadge :status="automation.status" />
                </RouterLink>
                <p v-if="!projectAutomations.length" class="muted">暂无明确关联到此项目的自动化。</p>
              </section>
            </div>
          </article>

          <article v-if="showMoreOverview" class="item wide collapsible-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>项目简报</h2>
                <p class="muted">围绕当前项目生成重点、复盘和待确认事项。</p>
              </div>
              <span class="row">
                <span class="segmented compact">
                  <button :class="{ active: briefingMode === 'daily' }" type="button" @click="briefingMode = 'daily'">今日</button>
                  <button :class="{ active: briefingMode === 'evening' }" type="button" @click="briefingMode = 'evening'">晚间</button>
                  <button :class="{ active: briefingMode === 'weekly' }" type="button" @click="briefingMode = 'weekly'">每周</button>
                </span>
                <button :disabled="briefingLoading" type="button" @click="generateProjectBriefing">
                  生成{{ briefingModeText(briefingMode) }}
                </button>
                <button class="inline secondary" type="button" @click="toggleOverviewSection('briefing')">{{ sectionToggleText('briefing') }}</button>
              </span>
            </div>
            <div v-if="overviewSections.briefing">
              <ErrorState v-if="sourceErrors.briefing" title="项目简报暂时无法加载" :message="sourceErrors.briefing" @retry="loadOverview" />
              <div v-else-if="projectBriefing" class="project-briefing-grid">
                <section class="project-briefing-main">
                  <div class="section-title">
                    <strong>{{ projectBriefing.title || briefingModeText(projectBriefing.briefingType) }}</strong>
                    <span class="badge">{{ projectBriefing.briefingType }}</span>
                  </div>
                  <pre>{{ projectBriefing.content }}</pre>
                </section>
                <section class="project-briefing-side">
                  <div class="project-health-item">
                    <div class="section-title">
                      <strong>重点</strong>
                      <span class="badge">{{ projectBriefing.todayFocus.length }}</span>
                    </div>
                    <p v-for="item in projectBriefing.todayFocus.slice(0, 4)" :key="item" class="memory-meta">{{ item }}</p>
                    <p v-if="projectBriefing.todayFocus.length === 0" class="muted">暂无重点建议。</p>
                  </div>
                  <div class="brief-metrics compact">
                    <RouterLink class="brief-metric pending" to="/tasks">
                      <strong>{{ projectBriefing.dueTasks.length }}</strong>
                      <span>今日到期</span>
                    </RouterLink>
                    <RouterLink class="brief-metric danger" to="/tasks">
                      <strong>{{ projectBriefing.overdueTasks.length }}</strong>
                      <span>已逾期</span>
                    </RouterLink>
                    <RouterLink class="brief-metric" to="/operations">
                      <strong>{{ projectBriefing.pendingOperations.length }}</strong>
                      <span>待确认</span>
                    </RouterLink>
                  </div>
                </section>
              </div>
              <div v-else class="empty-state compact">
                <strong>{{ briefingLoading ? '正在生成项目简报' : '暂无项目简报' }}</strong>
                <span>可以生成今日重点、晚间复盘或周复盘。</span>
              </div>
            </div>
          </article>

          <article v-if="!isFreshProject" class="item wide collapsible-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>风险与决策</h2>
                <p class="muted">把阻塞问题、关键判断和项目缺口沉淀到项目空间。</p>
              </div>
              <span class="row">
                <span class="badge" :class="{ pending: (overview?.openQuestions.length ?? 0) > 0, success: (overview?.decisions.length ?? 0) > 0 }">
                  {{ overview?.decisions.length ?? 0 }} 决策 · {{ overview?.openQuestions.length ?? 0 }} 问题
                </span>
                <button class="inline secondary" type="button" @click="toggleOverviewSection('risk')">{{ sectionToggleText('risk') }}</button>
              </span>
            </div>
            <div v-if="overviewSections.risk" class="project-risk-grid">
              <section class="project-risk-column">
                <div class="section-title">
                  <strong>当前风险</strong>
                  <span v-if="!sourceErrors.todos && !sourceErrors.goals && !sourceErrors.plans" class="badge">{{ projectRisks.length }}</span>
                </div>
                <p v-if="sourceErrors.todos || sourceErrors.goals || sourceErrors.plans" class="muted">相关数据尚未加载，暂不判断项目风险。</p>
                <div v-else-if="projectRisks.length" class="stack">
                  <div v-for="risk in projectRisks" :key="risk.id" class="project-risk-card" :class="risk.tone">
                    <strong>{{ risk.title }}</strong>
                    <span>{{ risk.detail }}</span>
                  </div>
                </div>
                <div v-else class="empty-state compact">
                  <strong>风险状态稳定</strong>
                  <span>当前没有明显阻塞，可以继续推进。</span>
                </div>
              </section>

              <section class="project-risk-column">
                <div class="section-title">
                  <strong>开放问题</strong>
                  <span class="badge">{{ overview?.openQuestions.length ?? 0 }}</span>
                </div>
                <div v-if="overview?.openQuestions.length" class="stack">
                  <div v-for="question in overview.openQuestions.slice(0, 4)" :key="question.id" class="project-action-row pending">
                    <div>
                      <strong>{{ question.question }}</strong>
                      <span>{{ question.status }} · {{ question.createdAt }}</span>
                    </div>
                    <button class="inline" :disabled="saving" type="button" @click="closeOpenQuestion(question)">关闭</button>
                  </div>
                </div>
                <form class="row project-quick-form" @submit.prevent="submitOpenQuestion">
                  <input v-model="questionForm.question" aria-label="待澄清问题" placeholder="记录一个待澄清问题" />
                  <button :disabled="saving || !questionForm.question.trim()" type="submit">记录</button>
                </form>
              </section>

              <section class="project-risk-column">
                <div class="section-title">
                  <strong>关键决策</strong>
                  <span class="badge">{{ overview?.decisions.length ?? 0 }}</span>
                </div>
                <div v-if="overview?.decisions.length" class="stack">
                  <div v-for="decision in overview.decisions.slice(0, 3)" :key="decision.id" class="project-decision-card">
                    <strong>{{ decision.title }}</strong>
                    <span>{{ decisionSummary(decision) }}</span>
                    <small class="memory-meta">{{ decision.status }} · {{ decision.createdAt }}</small>
                  </div>
                </div>
                <form class="stack" @submit.prevent="submitDecision">
                  <input v-model="decisionForm.title" aria-label="决策标题" placeholder="决策标题" />
                  <textarea v-model="decisionForm.content" aria-label="决策内容" rows="3" placeholder="决策内容、依据或验收口径" />
                  <button :disabled="saving || !decisionForm.title.trim() || !decisionForm.content.trim()" type="submit">记录决策</button>
                </form>
              </section>
            </div>
          </article>

          <button v-if="!isFreshProject" class="overview-more-toggle wide" type="button" :aria-expanded="showMoreOverview" @click="showMoreOverview = !showMoreOverview">
            {{ showMoreOverview ? '收起项目详情' : '展开健康度、简报、动态与设置' }}
          </button>

          <article v-if="showMoreOverview && !isFreshProject" class="item wide collapsible-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>最近动态</h2>
                <p class="muted">目标、任务、计划、决策和问题的近期变化。</p>
              </div>
              <span class="row">
                <span class="badge">{{ projectTimeline.length }}</span>
                <button class="inline secondary" type="button" @click="toggleOverviewSection('timeline')">{{ sectionToggleText('timeline') }}</button>
              </span>
            </div>
            <div v-if="overviewSections.timeline" class="project-timeline">
              <div v-for="item in projectTimeline" :key="item.id" class="project-timeline-item">
                <span class="timeline-dot">{{ item.type }}</span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.detail }}</span>
                  <small class="memory-meta">{{ formatTimelineTime(item.at) }}</small>
                </div>
              </div>
              <div v-if="projectTimeline.length === 0" class="empty-state compact">
                <strong>暂无动态</strong>
                <span>创建目标、任务、计划或决策后会出现在这里。</span>
              </div>
            </div>
          </article>

          <article v-if="showMoreOverview && !isFreshProject && !Object.values(sourceErrors).some(Boolean)" class="item wide collapsible-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>下一步建议</h2>
                <p class="muted">根据项目缺口生成可执行建议。</p>
              </div>
              <button class="inline secondary" type="button" @click="toggleOverviewSection('suggestions')">{{ sectionToggleText('suggestions') }}</button>
            </div>
            <div v-if="overviewSections.suggestions && groupedProjectSuggestions.length" class="project-suggestion-groups">
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
            <div v-else-if="overviewSections.suggestions && overview?.nextStepSuggestions.length" class="stack">
              <div v-for="suggestion in overview.nextStepSuggestions" :key="suggestion" class="brief-focus-item">
                <strong>{{ suggestion }}</strong>
              </div>
            </div>
            <p v-else-if="overviewSections.suggestions" class="muted">项目基础信息比较完整，可以继续推进目标拆解。</p>
          </article>

          <article v-if="showMoreOverview" class="item wide collapsible-section subtle-section">
            <div class="section-title collapsible-head">
              <div>
                <h2>项目设置</h2>
                <p class="muted">调整项目定位、当前阶段和优先级。</p>
              </div>
              <button class="inline secondary" type="button" @click="toggleOverviewSection('settings')">{{ sectionToggleText('settings') }}</button>
            </div>
            <div v-if="overviewSections.settings" class="stack">
              <label>项目定位<textarea ref="projectSettingsInput" v-model="editForm.description" rows="3" placeholder="这个项目要达成什么？" /></label>
              <label>当前阶段<input v-model="editForm.currentStage" placeholder="例如：方案验证" /></label>
              <label>优先级<input v-model.number="editForm.priority" type="number" /></label>
              <span class="row">
                <button :disabled="saving" type="button" @click="saveProject">保存</button>
                <button class="secondary" :disabled="saving" type="button" @click="archiveProject">归档</button>
              </span>
            </div>
          </article>
        </div>

        <div v-if="activeTab === 'goals'" class="grid project-goals-grid">
          <article class="item project-goal-create">
            <h2>新建目标</h2>
            <form class="stack" @submit.prevent="submitGoal">
              <label>目标标题<input ref="goalTitleInput" v-model="goalForm.title" placeholder="例如：完成第一版产品方案" /></label>
              <label>目标描述<textarea v-model="goalForm.description" rows="3" placeholder="写下可验证的预期结果" /></label>
              <label>目标周期<select v-model="goalForm.horizon">
                <option value="day">今日</option>
                <option value="week">本周</option>
                <option value="month">本月</option>
                <option value="quarter">季度</option>
                <option value="long_term">长期</option>
              </select></label>
              <label>截止时间（选填）<input v-model="goalForm.dueAt" type="datetime-local" /></label>
              <button :disabled="saving || !goalForm.title.trim()" type="submit">创建目标</button>
            </form>
          </article>

          <article class="item">
            <div class="section-title">
              <h2>目标进展</h2>
              <span v-if="!sourceErrors.goals" class="badge">{{ visibleActiveGoals.length }}</span>
            </div>
            <p v-if="duplicateGoalCount > 0" class="alert pending">已隐藏 {{ duplicateGoalCount }} 个重复标题目标，避免测试数据干扰判断。</p>
            <ErrorState v-if="sourceErrors.goals" title="目标暂时无法加载" :message="sourceErrors.goals" @retry="loadOverview" />
            <div v-else-if="visibleActiveGoals.length" class="stack">
              <div v-for="goal in visibleActiveGoals" :key="goal.id" class="goal-card">
                <div class="section-title">
                  <div>
                    <strong>{{ goal.title }}</strong>
                    <p class="muted">{{ goal.description || '暂无描述' }}</p>
                  </div>
                  <span class="badge">{{ horizonText(goal.horizon) }}</span>
                </div>
                <div class="progress-bar"><i :style="{ width: `${percent(goal.progress)}%` }" /></div>
                <span class="row">
                  <small class="memory-meta">{{ percent(goal.progress) }}% · {{ goal.dueAt || '未设置截止时间' }}</small>
                  <button class="inline secondary" type="button" @click="setGoalProgress(goal, Math.min(100, percent(goal.progress) + 25))">+25%</button>
                  <button class="inline" type="button" @click="completeGoal(goal)">完成</button>
                </span>
                <div class="goal-support" :class="goalSupportTone(goal)">
                  <div>
                    <small class="memory-meta">推进承接</small>
                    <strong>{{ goalSupportText(goal) }}</strong>
                    <span v-if="goalNextTodo(goal)">下一步：{{ goalNextTodo(goal)?.title }} · {{ formatTodoTime(goalNextTodo(goal)?.dueAt) }}</span>
                    <span v-else>建议先补一个可执行动作，目标会更容易持续推进。</span>
                  </div>
                  <span class="row">
                    <button class="inline secondary" :disabled="saving" type="button" @click="createNextActionTodo(goal)">创建待办</button>
                    <button class="inline" :disabled="saving" type="button" @click="createPlanFromActiveGoal(goal)">生成计划</button>
                  </span>
                </div>
                <div v-if="goalPlans(goal).length" class="goal-plan-links">
                  <small class="memory-meta">相关计划</small>
                  <button
                    v-for="plan in goalPlans(goal).slice(0, 3)"
                    :key="plan.id"
                    class="inline secondary"
                    type="button"
                    @click="openPlansTab"
                  >
                    {{ plan.title }} · {{ planStatusText(plan.status) }}
                  </button>
                </div>
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
                    <input v-model="milestoneForm(goal.id).title" :aria-label="`${goal.title}的里程碑标题`" placeholder="添加里程碑" />
                    <input v-model="milestoneForm(goal.id).dueAt" :aria-label="`${goal.title}的里程碑截止时间`" type="datetime-local" />
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
              <span v-if="!sourceErrors.plans" class="badge">{{ plans.length }}</span>
            </div>
            <ErrorState v-if="sourceErrors.plans" title="计划暂时无法加载" :message="sourceErrors.plans" @retry="loadOverview" />
            <div v-else-if="plans.length" class="stack">
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
                  <button class="secondary" type="button" :disabled="saving" @click="savePlanAsWorkflow(plan)">保存为工作流</button>
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
              <label>关联类型<select v-model="linkForm.targetType">
                <option value="todo">任务</option>
                <option value="knowledge_file">文件</option>
                <option value="memory_fragment">记忆</option>
                <option value="conversation">会话</option>
                <option value="decision">决策</option>
                <option value="open_question">开放问题</option>
              </select></label>
              <label>对象 ID<input v-model="linkForm.targetId" placeholder="填写已有任务、文件或记忆的 ID" /></label>
              <details class="project-optional"><summary>更多关联设置</summary><div class="stack"><label>关联关系<input v-model="linkForm.relation" placeholder="例如：related" /></label><label>置信度<input v-model.number="linkForm.confidence" type="number" min="0" max="1" step="0.05" /></label></div></details>
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
      </section>

      <section v-else class="empty-state project-unselected" aria-label="项目详情">
        <strong>选择或创建一个项目</strong>
        <span>项目页会汇总目标、任务、文件、记忆、决策和开放问题。</span>
      </section>
    </div>

    <DetailDrawer
      :open="showCreateProject"
      title="新建项目"
      description="给正在推进的事情一个空间，目标和资料可以随时补充。"
      @update:open="setProjectCreatorOpen"
    >
      <form id="create-project-form" class="stack" @submit.prevent="submitProject">
        <p v-if="projectCreateError" class="alert danger" role="alert">{{ projectCreateError }}</p>
        <label>项目名称<input ref="projectNameInput" v-model="projectForm.name" placeholder="例如：新产品上线" autofocus :disabled="saving" /></label>
        <label>一句话定位（选填）<textarea v-model="projectForm.description" rows="3" placeholder="这个项目想达成什么？" :disabled="saving" /></label>
        <details class="project-optional"><summary>更多设置（选填）</summary><div class="stack"><label>当前阶段<input v-model="projectForm.currentStage" placeholder="例如：方案验证" :disabled="saving" /></label><label>优先级<input v-model.number="projectForm.priority" type="number" :disabled="saving" /></label></div></details>
      </form>
      <template #footer>
        <AppButton variant="secondary" :disabled="saving" @click="setProjectCreatorOpen(false)">取消</AppButton>
        <AppButton form="create-project-form" :loading="saving" :disabled="!projectForm.name.trim()" type="submit">{{ saving ? '正在创建' : '创建项目' }}</AppButton>
      </template>
    </DetailDrawer>
  </section>
</template>

<style scoped>
.projects-page { max-width: 1180px; min-width: 0; width: 100%; margin: 0 auto; gap: 24px; }
.projects-page--empty { gap: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.projects-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 42px; }
.projects-header h1 { margin: 0; font-size: 30px; font-weight: 650; line-height: 1.35; letter-spacing: -.7px; }
.projects-header p { margin: 8px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.project-header-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.projects-welcome { display: flex; flex-direction: column; align-items: center; padding: 74px 24px 58px; text-align: center; }
.welcome-icon { display: grid; place-items: center; width: 84px; height: 84px; margin-bottom: 28px; border-radius: 23px; background: var(--primary-soft, #eef2ff); color: var(--primary); }
.projects-welcome h2 { margin: 0; color: var(--foreground); font-size: 34px; font-weight: 700; line-height: 1.4; letter-spacing: -.6px; }
.projects-welcome h2 > span { display: inline-block; }
.projects-welcome > p { margin: 18px 0 0; color: var(--muted-foreground); font-size: 18px; line-height: 1.7; }
.welcome-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 26px; margin-top: 30px; }
.welcome-actions .welcome-primary { min-height: 52px; padding: 13px 23px; border-radius: 10px; font-size: 16px; }
.text-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; border: 0; border-radius: 4px; padding: 4px 0; background: transparent; color: var(--primary); font-size: 14px; font-weight: 600; text-decoration: none; box-shadow: none; }
.welcome-actions .text-action { font-size: 16px; }
.text-action:hover { background: transparent; color: var(--primary-hover); text-decoration: underline; text-underline-offset: 4px; }
.projects-page button:focus-visible, .projects-page a:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.project-capabilities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; padding: 32px 0; border-top: 1px solid var(--border); }
.project-capabilities article { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
.capability-icon { display: grid; place-items: center; flex: 0 0 48px; height: 48px; border-radius: 12px; color: var(--primary); background: var(--primary-soft, #eef2ff); }
.project-capabilities h3 { margin: 2px 0 7px; font-size: 16px; line-height: 1.5; }
.project-capabilities p { max-width: 250px; margin: 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.project-notice { margin: 0; padding: 12px 16px; border: 1px solid var(--success-border); border-radius: 10px; background: var(--success-soft); color: var(--success-strong); font-size: 14px; line-height: 1.6; }
.project-layout { grid-template-columns: 250px minmax(0, 1fr); gap: 24px; min-width: 0; }
.projects-page .item { min-width: 0; border: 1px solid var(--border); border-radius: 13px; background: var(--surface); padding: 22px; box-shadow: none; }
.projects-page .item h2 { margin: 0; color: var(--foreground); font-size: 18px; line-height: 1.5; }
.projects-page .item .muted { margin: 7px 0 0; font-size: 13px; line-height: 1.7; }
.projects-page .section-title { min-width: 0; margin: 0 0 16px; gap: 12px; }
.projects-page .section-title > div { min-width: 0; }
.projects-page .item.project-sidebar { gap: 12px; padding: 17px 12px; }
.projects-page .project-sidebar .section-title { flex-direction: row; align-items: center; margin: 0 4px 3px; }
.project-sidebar .section-title h2 { font-size: 15px; }
.project-count { color: var(--muted-foreground); font-size: 12px; }
.projects-page .project-search { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; color: var(--muted-foreground); }
.project-search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft); }
.project-search input { min-width: 0; width: 100%; min-height: 38px; border: 0; outline: 0; box-shadow: none; padding: 7px 0; background: transparent; font-size: 13px; }
.project-sidebar > select { min-width: 0; width: 100%; min-height: 36px; padding: 7px 10px; font-size: 12px; background: var(--surface-muted); }
.project-list { display: grid; gap: 5px; min-width: 0; }
.project-list-item { display: flex; align-items: center; gap: 10px; min-width: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; padding: 12px 9px; }
.project-list-item > svg { flex-shrink: 0; color: var(--muted-foreground); }
.project-list-item > svg:last-child { margin-left: auto; opacity: 0; }
.project-list-item:hover { background: var(--surface-muted); }
.project-list-item.router-link-active { background: var(--primary-soft, #eef2ff); border-color: var(--primary-border, #c7d2fe); }
.project-list-item.router-link-active > svg { color: var(--primary); }
.project-list-item.router-link-active > svg:last-child { opacity: 1; }
.project-list-item .project-list-copy { display: grid; gap: 5px; min-width: 0; }
.project-list-copy strong { color: var(--foreground); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.project-list-item.router-link-active strong { color: var(--primary); }
.project-list-copy small { color: var(--muted-foreground); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.project-filter-empty { padding: 22px 8px; text-align: center; font-size: 13px; }
.project-filter-empty p { color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
.project-detail { min-width: 0; gap: 20px; }
.project-detail-header .section-title { align-items: flex-start; margin: 0; }
.project-eyebrow { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; color: var(--muted-foreground); font-size: 12px; }
.project-eyebrow > svg { color: var(--primary); }
.projects-page .project-detail-header h2 { font-size: 24px; font-weight: 650; line-height: 1.5; letter-spacing: -.4px; overflow-wrap: anywhere; }
.project-detail-header .muted { max-width: 570px; overflow-wrap: anywhere; }
.project-detail-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.project-detail-actions :deep(.app-button) { font-size: 12px; }
.project-tabs { display: flex; width: 100%; box-sizing: border-box; gap: 26px; border-bottom: 1px solid var(--border); padding: 0 4px; }
.project-tabs button { min-height: 43px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted-foreground); padding: 9px 5px 13px; font-size: 14px; font-weight: 550; box-shadow: none; }
.project-tabs button.active { border-bottom-color: var(--primary); color: var(--primary); font-weight: 650; }
.project-tabs button:hover { color: var(--primary); }
.project-overview-grid { gap: 20px; }
.projects-page .project-starter { padding: 28px; }
.project-starter > p { margin: 9px 0 24px; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.project-starter-actions { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; }
.project-starter-actions button { display: grid; min-width: 0; justify-items: start; gap: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--foreground); padding: 19px 16px; text-align: left; box-shadow: none; }
.project-starter-actions button:hover { border-color: var(--primary-border); background: var(--primary-soft); }
.project-starter-actions svg { color: var(--primary); }
.project-starter-actions strong { margin-top: 7px; font-size: 14px; line-height: 1.6; }
.project-starter-actions span { color: var(--muted-foreground); font-size: 12px; font-weight: 400; line-height: 1.6; }
.project-starter-actions svg:last-child { margin-top: 4px; }
.starter-briefing { margin-top: 18px; font-size: 13px; }
.project-source-warning { display: flex; align-items: center; justify-content: space-between; gap: 16px; border: 1px solid var(--warning-border); border-radius: 10px; background: var(--warning-soft); padding: 16px; font-size: 13px; }
.project-source-warning p { margin: 6px 0 0; line-height: 1.65; color: var(--muted-foreground); }
.project-source-warning button { flex-shrink: 0; }
.projects-page .empty-state { border: 0; background: var(--surface-muted); padding: 25px 16px; }
.projects-page .empty-state strong { font-size: 15px; }
.projects-page .empty-state span { font-size: 13px; line-height: 1.7; }
.projects-page .project-unselected { min-height: 290px; justify-content: center; border: 1px solid var(--border); background: var(--surface); }
.projects-page .project-next-action { border: 0; border-radius: 10px; background: var(--primary-soft); padding: 18px; }
.project-next-action > strong { font-size: 17px; line-height: 1.65; }
.projects-page .project-action-row { border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent; padding: 14px 0; }
.project-action-row > div { min-width: 0; }
.project-action-row strong { font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
.project-action-row span { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.projects-page .project-risk-grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 22px; }
.project-risk-column:first-child { grid-column: 1 / -1; }
.project-risk-column:first-child > .stack { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.projects-page .project-risk-card, .projects-page .project-decision-card { padding: 14px; font-size: 13px; }
.project-risk-card span, .project-decision-card span { line-height: 1.7; }
.projects-page label, :deep(.detail-drawer label) { display: grid; gap: 7px; min-width: 0; color: var(--foreground); font-size: 13px; font-weight: 600; }
.projects-page label input, .projects-page label textarea, .projects-page label select { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; font-size: 13px; font-weight: 400; }
.projects-page .row { flex-wrap: wrap; }
.projects-page .inline { min-height: 32px; padding: 6px 10px; font-size: 12px; }
.project-optional { min-width: 0; border-top: 1px solid var(--border); margin-top: 8px; }
.project-optional summary { padding: 15px 0; color: var(--muted-foreground); font-size: 13px; cursor: pointer; }
.project-optional > .stack { padding-bottom: 10px; }
.project-goals-grid { grid-template-columns: minmax(0,1fr); }
.project-goal-create form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
.project-goal-create label:nth-child(2) { grid-column: 1 / -1; }
.project-goal-create label:first-child { grid-column: 1 / -1; }
.project-goal-create button { justify-self: start; }
.projects-page .goal-card { min-width: 0; padding: 18px; border-color: var(--border); background: var(--surface); }
.projects-page .milestone-form { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto; }
.milestone-form input { min-width: 0; width: 100%; }
.project-summary-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-4); }
.project-summary-strip > span { display: flex; min-width: 0; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 7px 0; color: var(--muted-foreground); font-size: 12px; }
.project-summary-strip strong { overflow: hidden; color: var(--foreground); font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }.project-summary-strip .danger strong { color: var(--danger-strong); }
.project-summary-strip small { color: var(--danger-strong); font-size: 11px; }
.overview-more-toggle { min-height: 44px; border: 0; background: transparent; color: var(--muted-foreground); font-size: 13px; }
.overview-more-toggle:hover { background: var(--surface-muted); color: var(--primary); }
.project-activity-section { display: grid; gap: var(--space-4); }
.project-activity-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); }
.project-activity-grid > section { display: grid; align-content: start; gap: var(--space-3); min-width: 0; }
.project-linked-item { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--border); border-radius: 9px; background: var(--surface); padding: 12px; }
.project-linked-item:hover { border-color: var(--primary-border); background: var(--primary-soft); }
.project-linked-item > span:first-child { display: grid; min-width: 0; gap: 3px; }
.project-linked-item strong, .project-linked-item small { overflow-wrap: anywhere; line-height: 1.65; font-size: 13px; }
.project-linked-item small { font-size: 12px; }
.project-linked-item small { color: var(--muted-foreground); }
@media (max-width: 1100px) {
  .project-layout { grid-template-columns: 215px minmax(0, 1fr); gap: 18px; }
  .project-detail-header .section-title { flex-direction: column; }
  .project-starter-actions { gap: 10px; }
  .project-starter-actions button { padding: 16px 12px; }
  .projects-page .project-starter { padding: 22px; }
}
@media (max-width: 800px) {
  .project-layout { grid-template-columns: minmax(0, 1fr); }
  .project-list { grid-template-columns: repeat(2,minmax(0,1fr)); max-height: 220px; overflow-y: auto; }
  .project-sidebar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .project-sidebar .section-title, .project-list, .project-filter-empty { grid-column: 1 / -1; }
  .project-capabilities { gap: 18px; }
  .project-capabilities article { gap: 12px; }
}
@media (max-width: 680px) {
  .projects-page { gap: 18px; }.projects-page--empty { gap: 0; }
  .projects-header { gap: 12px; align-items: flex-start; }.projects-header h1 { font-size: 26px; }.projects-header p { display: none; }
  .project-header-actions { gap: 3px; }.project-header-actions :deep(.app-button) { padding: 8px 10px; font-size: 13px; }
  .projects-welcome { padding: 30px 4px 36px; }.welcome-icon { width: 64px; height: 64px; border-radius: 18px; margin-bottom: 20px; }.welcome-icon > svg { width: 31px; height: 31px; }
  .projects-welcome h2 { max-width: 300px; font-size: 27px; }.projects-welcome > p { max-width: 285px; font-size: 15px; margin-top: 12px; }.desktop-break { display: none; }
  .welcome-actions { gap: 14px; margin-top: 24px; }.welcome-actions .welcome-primary { min-height: 46px; padding: 11px 16px; font-size: 14px; }.welcome-actions .text-action { font-size: 14px; }
  .project-capabilities { grid-template-columns: minmax(0,1fr); gap: 22px; padding-top: 26px; }.project-capabilities article { gap: 15px; }.project-capabilities h3 { margin-bottom: 4px; font-size: 15px; }.project-capabilities p { max-width: 100%; font-size: 13px; }.capability-icon { flex-basis: 42px; height: 42px; border-radius: 11px; }
  .projects-page .item { padding: 18px 16px; }.project-detail { gap: 16px; }.projects-page .project-detail-header h2 { font-size: 22px; }
  .project-list-item { padding: 10px 6px; gap: 8px; }.project-list-copy strong { font-size: 12px; }.project-list-item > svg:last-child { display: none; }
  .project-summary-strip { grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }.project-summary-strip > span { display: grid; gap: 5px; font-size: 10px; }.project-summary-strip strong { font-size: 18px; }
  .project-starter-actions { grid-template-columns: minmax(0,1fr); }.project-starter-actions button { grid-template-columns: 28px minmax(0,1fr) 20px; gap: 4px 12px; padding: 16px; }.project-starter-actions svg:first-child { grid-row: 1 / 3; align-self: center; }.project-starter-actions strong { margin: 0; }.project-starter-actions span { grid-column: 2; }.project-starter-actions svg:last-child { grid-column: 3; grid-row: 1 / 3; align-self: center; margin: 0; }
  .project-activity-grid, .projects-page .project-risk-grid, .project-risk-column:first-child > .stack { grid-template-columns: minmax(0,1fr); }.project-risk-column:first-child { grid-column: auto; }
  .projects-page .section-title { flex-wrap: wrap; }.projects-page .project-action-row { display: grid; grid-template-columns: minmax(0,1fr); gap: 10px; }.project-action-row > .row { justify-content: flex-start; }
  .project-source-warning { flex-direction: column; align-items: flex-start; }
  .project-goal-create form { grid-template-columns: minmax(0,1fr); }.project-goal-create label { grid-column: auto !important; }
  .projects-page .milestone-form { grid-template-columns: minmax(0,1fr); }
}
</style>
