<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  cancelAgentPlan,
  confirmAgentPlan,
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
            <div v-if="overview?.nextStepSuggestions.length" class="stack">
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
