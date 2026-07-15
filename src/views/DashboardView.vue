<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowRight,
  Bot,
  CircleAlert,
  Clock3,
  FolderKanban,
  ListTodo,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Workflow
} from '@lucide/vue'
import { getCurrentUser } from '@/auth'
import { getDashboardViewModel } from '@/api/adapters/dashboard'
import { trackProductEvent } from '@/api/app'
import type { DashboardSource, DashboardViewModel } from '@/api/adapters/dashboard'
import {
  useWorkspaceStore,
  WORKSPACE_QUICK_INTENTS
} from '@/stores/workspace'
import type { WorkspaceProjectContext, WorkspaceQuickIntentId } from '@/stores/workspace'

const router = useRouter()
const workspace = useWorkspaceStore()
const dashboard = ref<DashboardViewModel | null>(null)
const loading = ref(false)
const fatalError = ref('')
const chatDraft = ref('')
const selectedProjectId = ref<number | null>(null)

const quickIntents: WorkspaceQuickIntentId[] = ['organize-project', 'make-plan', 'research', 'inspect']
const userName = getCurrentUser()?.username?.trim() || ''

const greeting = computed(() => {
  const hour = new Date().getHours()
  const salutation = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  return userName ? `${salutation}，${userName}` : salutation
})

const todayLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long'
}).format(new Date()))

const selectedProject = computed<WorkspaceProjectContext | null>(() => {
  if (!selectedProjectId.value) return null
  const project = dashboard.value?.activeProjects.find((item) => item.id === selectedProjectId.value)
  return project ? { id: project.id, name: project.name } : { id: selectedProjectId.value }
})

const actionSourceErrors = computed(() => {
  if (!dashboard.value) return []
  return (['confirmations', 'results', 'connections'] as DashboardSource[])
    .map((source) => dashboard.value?.sources[source])
    .filter((state) => state?.status === 'error')
    .map((state) => state?.message || '部分待处理信息未加载')
})

const lastUpdated = computed(() => {
  if (!dashboard.value) return ''
  const date = new Date(dashboard.value.generatedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})

const overdueCount = computed(() => dashboard.value?.todayFocus.filter((item) => item.tone === 'danger').length || 0)
const confirmationCount = computed(() => dashboard.value?.actionItems.filter((item) => item.kind === 'confirmation').length || 0)
const failedResultCount = computed(() => dashboard.value?.actionItems.filter((item) => item.kind === 'execution' && item.tone === 'danger').length || 0)

onMounted(() => {
  recordProductEvent('dashboard_viewed')
  void refresh()
})

async function refresh() {
  loading.value = true
  fatalError.value = ''
  try {
    const nextDashboard = await getDashboardViewModel()
    dashboard.value = nextDashboard
    if (
      selectedProjectId.value
      && !nextDashboard.activeProjects.some((project) => project.id === selectedProjectId.value)
    ) {
      selectedProjectId.value = null
    }
    if (selectedProjectId.value === null && nextDashboard.activeProjects.length === 1) {
      selectedProjectId.value = nextDashboard.activeProjects[0]?.id ?? null
    }
  } catch (error) {
    fatalError.value = error instanceof Error ? error.message : '工作台加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function submitChatDraft() {
  const draft = chatDraft.value.trim()
  if (!draft) return
  workspace.stageChatDraft(draft, selectedProject.value, 'dashboard')
  recordProductEvent('quick_intent_submitted', 'freeform')
  chatDraft.value = ''
  await router.push({ name: 'chat' })
}

async function startQuickIntent(intentId: WorkspaceQuickIntentId) {
  workspace.stageQuickIntent(intentId, selectedProject.value, 'dashboard')
  recordProductEvent('quick_intent_submitted', intentId)
  await router.push({ name: 'chat' })
}

async function startBlankChat() {
  workspace.stageChatDraft('', selectedProject.value, 'dashboard')
  recordProductEvent('dashboard_action_clicked', 'start_chat')
  await router.push({ name: 'chat' })
}

function recordProductEvent(eventType: string, actionType?: string) {
  void trackProductEvent({
    eventType,
    page: 'dashboard',
    actionType,
    ...(selectedProjectId.value ? { projectId: selectedProjectId.value } : {})
  }).catch(() => undefined)
}

function sourceFailed(source: DashboardSource) {
  return dashboard.value?.sources[source].status === 'error'
}

function formatRelativeTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待确认'
  const difference = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.floor(difference / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function focusToneLabel(tone: string) {
  if (tone === 'danger') return '已逾期'
  if (tone === 'warning') return '今日到期'
  return '建议'
}

function actionKindLabel(kind: string) {
  if (kind === 'confirmation') return '等待确认'
  if (kind === 'connection') return '连接异常'
  return '执行异常'
}
</script>

<template>
  <section class="page dashboard-page" :aria-busy="loading">
    <header class="dashboard-header">
      <div>
        <p class="page-kicker">个人 AI 工作台</p>
        <h1>工作台</h1>
        <p class="page-description">先看今天最值得处理的事，再继续推进。</p>
      </div>
      <button class="refresh-button" type="button" :disabled="loading" @click="refresh">
        <RefreshCw :size="16" :class="{ spinning: loading }" aria-hidden="true" />
        {{ loading ? '刷新中' : '刷新' }}
      </button>
    </header>

    <nav v-if="loading && !dashboard" class="priority-summary priority-summary-loading" aria-label="正在加载关键状态">
      <span v-for="index in 3" :key="index" aria-hidden="true" />
    </nav>
    <nav v-else-if="dashboard && !dashboard.allFailed" class="priority-summary" aria-label="关键状态">
      <RouterLink class="priority-chip danger" to="/tasks">
        <strong>{{ overdueCount }}</strong><span>个逾期</span>
      </RouterLink>
      <RouterLink class="priority-chip warning" to="/execution-center?view=confirmations">
        <strong>{{ confirmationCount }}</strong><span>个待确认</span>
      </RouterLink>
      <RouterLink class="priority-chip danger" to="/execution-center?view=attention">
        <strong>{{ failedResultCount }}</strong><span>个失败结果</span>
      </RouterLink>
    </nav>

    <section class="command-card" aria-labelledby="dashboard-greeting">
      <div class="greeting-copy">
        <p>{{ todayLabel }}</p>
        <h2 id="dashboard-greeting">{{ greeting }}</h2>
        <span>今天想推进什么？告诉 Lyle 目标，或从一个常用意图开始。</span>
      </div>

      <form class="chat-composer" @submit.prevent="submitChatDraft">
        <label class="sr-only" for="dashboard-chat-draft">今天想推进什么？</label>
        <textarea
          id="dashboard-chat-draft"
          v-model="chatDraft"
          rows="2"
          placeholder="例如：整理本周发布计划，指出仍未解决的风险……"
          @keydown.meta.enter.prevent="submitChatDraft"
          @keydown.ctrl.enter.prevent="submitChatDraft"
        />
        <div class="composer-footer">
          <label class="project-context">
            <FolderKanban :size="15" aria-hidden="true" />
            <span class="sr-only">关联项目</span>
            <select v-model="selectedProjectId" aria-label="关联项目">
              <option :value="null">不关联项目</option>
              <option v-for="project in dashboard?.activeProjects || []" :key="project.id" :value="project.id">
                {{ project.name }}
              </option>
            </select>
          </label>
          <span class="shortcut-hint">⌘ / Ctrl + Enter 发送</span>
          <button class="send-button" type="submit" :disabled="!chatDraft.trim()">
            开始推进
            <ArrowRight :size="16" aria-hidden="true" />
          </button>
        </div>
      </form>

      <div class="intent-list" aria-label="快捷意图">
        <span>快捷意图</span>
        <button
          v-for="intentId in quickIntents"
          :key="intentId"
          type="button"
          @click="startQuickIntent(intentId)"
        >
          <Sparkles :size="14" aria-hidden="true" />
          {{ WORKSPACE_QUICK_INTENTS[intentId].label }}
        </button>
      </div>
    </section>

    <div v-if="loading && !dashboard" class="dashboard-grid loading-grid" aria-label="正在加载工作台">
      <div v-for="index in 4" :key="index" class="panel-card skeleton-card" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>

    <section v-else-if="fatalError" class="full-state error-state" role="alert">
      <span class="state-icon"><CircleAlert :size="22" aria-hidden="true" /></span>
      <div>
        <h2>工作台加载失败</h2>
        <p>{{ fatalError }}</p>
      </div>
      <button type="button" :disabled="loading" @click="refresh">重新加载</button>
    </section>

    <template v-else-if="dashboard">
      <section v-if="dashboard.allFailed" class="full-state error-state" role="alert">
        <span class="state-icon"><CircleAlert :size="22" aria-hidden="true" /></span>
        <div>
          <h2>工作台数据暂时不可用</h2>
          <p>今日重点、待处理事项、最近结果和连接状态均未成功加载。快捷输入仍可正常使用。</p>
        </div>
        <button type="button" :disabled="loading" @click="refresh">重试</button>
      </section>

      <section v-else-if="dashboard.partialFailure" class="partial-warning" role="status">
        <CircleAlert :size="18" aria-hidden="true" />
        <div>
          <strong>部分信息未能更新</strong>
          <p>{{ Object.values(dashboard.sources).filter((source) => source.status === 'error').map((source) => source.message).join('、') }}。其他内容已正常展示。</p>
        </div>
        <button type="button" :disabled="loading" @click="refresh">重试</button>
      </section>

      <section v-if="dashboard.confirmedEmpty" class="first-run-card">
        <span class="first-run-icon"><Bot :size="25" aria-hidden="true" /></span>
        <div>
          <p class="page-kicker">从第一次推进开始</p>
          <h2>这里还很安静，先让 Lyle 了解你的工作</h2>
          <p>创建一个项目，或运行首次巡检。之后工作台会在这里汇总重点、结果和需要你处理的事项。</p>
          <div class="first-run-actions">
            <RouterLink class="primary-link" to="/automations">
              <Play :size="16" aria-hidden="true" />
              运行首次巡检
            </RouterLink>
            <RouterLink class="secondary-link" to="/projects">
              <Plus :size="16" aria-hidden="true" />
              创建项目
            </RouterLink>
          </div>
        </div>
      </section>

      <div v-if="!dashboard.allFailed && !dashboard.confirmedEmpty" class="dashboard-grid">
        <section class="panel-card" aria-labelledby="today-focus-title">
          <header class="panel-header">
            <div>
              <p class="panel-kicker">优先处理</p>
              <h2 id="today-focus-title">今日重点</h2>
            </div>
            <RouterLink to="/tasks">查看任务 <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
          </header>

          <div v-if="dashboard.todayFocus.length" class="item-list">
            <RouterLink
              v-for="item in dashboard.todayFocus"
              :key="item.id"
              class="list-item focus-item"
              :class="`tone-${item.tone}`"
              :to="item.target"
            >
              <span class="tone-label">{{ focusToneLabel(item.tone) }}</span>
              <span class="item-copy"><strong>{{ item.title }}</strong><small>{{ item.meta }}</small></span>
              <ArrowRight :size="16" aria-hidden="true" />
            </RouterLink>
          </div>
          <div v-else-if="sourceFailed('briefing')" class="section-state warning-state">
            <CircleAlert :size="20" aria-hidden="true" />
            <strong>今日重点未加载</strong>
            <span>当前状态未知，重试后再查看。</span>
          </div>
          <div v-else class="section-state success-state">
            <Clock3 :size="20" aria-hidden="true" />
            <strong>今天没有紧急事项</strong>
            <span>可以从上方输入框发起下一项工作。</span>
          </div>
        </section>

        <section class="panel-card attention-card" aria-labelledby="attention-title">
          <header class="panel-header">
            <div>
              <p class="panel-kicker">需要你的决定</p>
              <h2 id="attention-title">待我处理</h2>
            </div>
            <RouterLink to="/execution-center">进入执行中心 <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
          </header>

          <div v-if="dashboard.actionItems.length" class="item-list">
            <RouterLink
              v-for="item in dashboard.actionItems"
              :key="item.id"
              class="list-item action-item"
              :class="`tone-${item.tone}`"
              :to="item.target"
            >
              <span class="tone-label">{{ actionKindLabel(item.kind) }}</span>
              <span class="item-copy"><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
              <ArrowRight :size="16" aria-hidden="true" />
            </RouterLink>
            <p v-if="actionSourceErrors.length" class="inline-warning">
              {{ actionSourceErrors.join('、') }}，当前列表可能不完整。
            </p>
          </div>
          <div v-else-if="actionSourceErrors.length" class="section-state warning-state">
            <CircleAlert :size="20" aria-hidden="true" />
            <strong>待处理状态未完全加载</strong>
            <span>{{ actionSourceErrors.join('、') }}。</span>
          </div>
          <div v-else class="section-state success-state">
            <Sparkles :size="20" aria-hidden="true" />
            <strong>暂时没有待处理事项</strong>
            <span>确认、连接异常和失败结果会集中出现在这里。</span>
          </div>
        </section>

        <section class="panel-card" aria-labelledby="recent-results-title">
          <header class="panel-header">
            <div>
              <p class="panel-kicker">Lyle 最近完成</p>
              <h2 id="recent-results-title">最近结果</h2>
            </div>
            <RouterLink to="/execution-center">查看全部 <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
          </header>

          <div v-if="dashboard.recentResults.length" class="item-list">
            <RouterLink v-for="item in dashboard.recentResults" :key="item.id" class="result-item" :to="item.target">
              <span class="result-topline">
                <span class="result-status" :class="`status-${item.status}`">{{ item.statusLabel }}</span>
                <time :datetime="item.createdAt">{{ formatRelativeTime(item.createdAt) }}</time>
              </span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.conclusion }}</p>
            </RouterLink>
          </div>
          <div v-else-if="sourceFailed('results')" class="section-state warning-state">
            <CircleAlert :size="20" aria-hidden="true" />
            <strong>最近结果未加载</strong>
            <span>这不是空记录，请重试获取结果。</span>
          </div>
          <div v-else class="section-state">
            <Workflow :size="20" aria-hidden="true" />
            <strong>还没有执行结果</strong>
            <span>运行巡检或自动化后，用户可读结果会显示在这里。</span>
          </div>
        </section>

        <section class="panel-card" aria-labelledby="active-projects-title">
          <header class="panel-header">
            <div>
              <p class="panel-kicker">共同上下文</p>
              <h2 id="active-projects-title">活跃项目</h2>
            </div>
            <RouterLink to="/projects">全部项目 <ArrowRight :size="14" aria-hidden="true" /></RouterLink>
          </header>

          <div v-if="dashboard.activeProjects.length" class="item-list">
            <RouterLink v-for="project in dashboard.activeProjects" :key="project.id" class="project-item" :to="project.target">
              <span class="project-icon"><FolderKanban :size="18" aria-hidden="true" /></span>
              <span class="item-copy">
                <span class="project-title-row"><strong>{{ project.name }}</strong><small>{{ formatRelativeTime(project.updatedAt) }}</small></span>
                <small>{{ project.stage }}</small>
                <span>{{ project.nextStep }}</span>
              </span>
              <ArrowRight :size="16" aria-hidden="true" />
            </RouterLink>
          </div>
          <div v-else-if="sourceFailed('briefing')" class="section-state warning-state">
            <CircleAlert :size="20" aria-hidden="true" />
            <strong>项目进展未加载</strong>
            <span>当前状态未知，重试后再查看。</span>
          </div>
          <div v-else class="section-state">
            <FolderKanban :size="20" aria-hidden="true" />
            <strong>还没有活跃项目</strong>
            <RouterLink class="text-link" to="/projects">创建第一个项目</RouterLink>
          </div>
        </section>
      </div>

      <section v-if="!dashboard.allFailed" class="quick-actions" aria-labelledby="quick-actions-title">
        <header>
          <div>
            <p class="panel-kicker">继续推进</p>
            <h2 id="quick-actions-title">快捷动作</h2>
          </div>
          <span v-if="lastUpdated">更新于 {{ lastUpdated }}</span>
        </header>
        <div class="quick-action-grid">
          <button type="button" @click="startBlankChat">
            <span><MessageCircle :size="19" aria-hidden="true" /></span>
            <strong>开始对话</strong>
            <small>从当前上下文继续</small>
          </button>
          <RouterLink to="/tasks">
            <span><ListTodo :size="19" aria-hidden="true" /></span>
            <strong>创建任务</strong>
            <small>记录下一步行动</small>
          </RouterLink>
          <button type="button" @click="startQuickIntent('inspect')">
            <span><Play :size="19" aria-hidden="true" /></span>
            <strong>运行巡检</strong>
            <small>查找风险和阻塞</small>
          </button>
          <RouterLink to="/automations">
            <span><Workflow :size="19" aria-hidden="true" /></span>
            <strong>创建自动化</strong>
            <small>让结果持续交付</small>
          </RouterLink>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.dashboard-page {
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  gap: 20px;
  padding-bottom: 32px;
  color: var(--foreground);
}

.dashboard-header,
.panel-header,
.quick-actions > header,
.composer-footer,
.result-topline,
.project-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-header h1,
.greeting-copy h2,
.panel-header h2,
.first-run-card h2,
.quick-actions h2,
.full-state h2 {
  margin: 0;
  color: var(--foreground);
}

.dashboard-header h1 {
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  letter-spacing: -0.035em;
}

.page-kicker,
.panel-kicker {
  margin: 0 0 4px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.page-description {
  margin: 5px 0 0;
  color: var(--muted-foreground);
}

.refresh-button,
.send-button,
.partial-warning button,
.full-state button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 10px;
  font-weight: 700;
}

.refresh-button {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--foreground);
}

.priority-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.priority-chip {
  display: flex;
  min-width: 0;
  min-height: 48px;
  align-items: baseline;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--foreground);
  padding: 10px 14px;
}

.priority-chip strong { font-size: 21px; line-height: 1; }
.priority-chip span { overflow: hidden; color: var(--muted-foreground); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.priority-chip.danger strong { color: var(--danger-strong); }
.priority-chip.warning strong { color: var(--warning-strong); }
.priority-summary-loading span { min-height: 48px; border-radius: 12px; background: linear-gradient(90deg, var(--surface-muted), var(--surface), var(--surface-muted)); background-size: 220% 100%; animation: shimmer 1.3s linear infinite; }

.command-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--lyle-color-indigo-200);
  border-radius: 18px;
  background:
    radial-gradient(circle at 92% 0%, color-mix(in srgb, var(--lyle-color-indigo-200) 72%, transparent), transparent 34%),
    linear-gradient(145deg, var(--lyle-color-white) 18%, color-mix(in srgb, var(--accent) 55%, var(--surface)) 100%);
  padding: clamp(14px, 2.5vw, 22px);
  box-shadow: 0 14px 38px color-mix(in srgb, var(--lyle-color-indigo-800) 8%, transparent);
}

.greeting-copy {
  max-width: 780px;
}

.greeting-copy p {
  margin: 0 0 8px;
  color: var(--lyle-color-indigo-500);
  font-size: 13px;
  font-weight: 700;
}

.greeting-copy h2 {
  font-size: clamp(1.4rem, 3vw, 1.75rem);
  letter-spacing: -0.035em;
}

.greeting-copy span {
  display: block;
  margin-top: 4px;
  color: var(--lyle-color-slate-600);
  line-height: 1.55;
}

.chat-composer {
  overflow: hidden;
  margin-top: 14px;
  border: 1px solid var(--lyle-color-slate-300);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--foreground) 8%, transparent);
}

.chat-composer textarea {
  min-height: 52px;
  resize: vertical;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lyle-color-slate-900);
  line-height: 1.55;
  padding: 12px 14px;
  outline: 0;
}

.chat-composer:focus-within {
  border-color: var(--primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--focus-ring) 13%, transparent),
    0 8px 28px color-mix(in srgb, var(--foreground) 8%, transparent);
}

.composer-footer {
  min-height: 46px;
  border-top: 1px solid var(--lyle-color-slate-100);
  padding: 8px 10px 8px 14px;
}

.project-context {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--lyle-color-slate-500);
}

.project-context select {
  width: min(230px, 35vw);
  min-height: 34px;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--lyle-color-slate-600);
  padding: 4px 24px 4px 2px;
  text-overflow: ellipsis;
}

.shortcut-hint {
  margin-left: auto;
  color: var(--lyle-color-slate-400);
  font-size: 12px;
}

.send-button,
.primary-link {
  background: var(--primary);
  color: var(--lyle-color-white);
}

.send-button:hover:not(:disabled),
.primary-link:hover {
  background: var(--lyle-color-indigo-700);
}

.intent-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.intent-list > span {
  margin-right: 2px;
  color: var(--lyle-color-slate-500);
  font-size: 12px;
  font-weight: 700;
}

.intent-list button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--lyle-color-slate-200);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  color: var(--lyle-color-slate-600);
  font-size: 13px;
  padding: 6px 11px;
}

.intent-list button:hover {
  border-color: var(--lyle-color-indigo-300);
  background: var(--lyle-color-white);
  color: var(--lyle-color-indigo-800);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.panel-card,
.quick-actions {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  padding: clamp(16px, 2.5vw, 22px);
  box-shadow: 0 4px 18px color-mix(in srgb, var(--foreground) 3.5%, transparent);
}

.panel-header {
  align-items: flex-start;
  margin-bottom: 16px;
}

.panel-header h2,
.quick-actions h2 {
  font-size: 18px;
  letter-spacing: -0.015em;
}

.panel-header > a {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: var(--lyle-color-indigo-600);
  font-size: 13px;
  font-weight: 700;
}

.item-list {
  display: grid;
  gap: 9px;
}

.list-item,
.project-item {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  border: 1px solid var(--lyle-color-slate-200);
  border-radius: 12px;
  background: var(--lyle-color-slate-25);
  color: var(--lyle-color-slate-700);
  padding: 12px;
  transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
}

.list-item:hover,
.project-item:hover,
.result-item:hover {
  border-color: var(--lyle-color-indigo-200);
  background: color-mix(in srgb, var(--accent) 55%, var(--surface));
  transform: translateY(-1px);
}

.item-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.item-copy strong,
.result-item strong {
  overflow: hidden;
  color: var(--lyle-color-slate-800);
  line-height: 1.35;
  text-overflow: ellipsis;
}

.item-copy small {
  overflow: hidden;
  color: var(--lyle-color-slate-500);
  line-height: 1.4;
  text-overflow: ellipsis;
}

.tone-label,
.result-status {
  display: inline-flex;
  width: fit-content;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  padding: 6px 8px;
  white-space: nowrap;
}

.tone-label {
  background: var(--lyle-color-indigo-50);
  color: var(--lyle-color-indigo-700);
}

.tone-danger .tone-label,
.status-failed {
  background: var(--lyle-color-rose-50);
  color: var(--lyle-color-rose-700);
}

.tone-warning .tone-label,
.status-partial,
.status-awaiting_confirmation {
  background: var(--lyle-color-amber-50);
  color: var(--lyle-color-amber-700);
}

.status-completed {
  background: var(--lyle-color-emerald-50);
  color: var(--lyle-color-emerald-700);
}

.result-item {
  display: grid;
  gap: 7px;
  border: 1px solid var(--lyle-color-slate-200);
  border-radius: 12px;
  background: var(--lyle-color-slate-25);
  padding: 13px;
  transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
}

.result-topline time,
.project-title-row small {
  color: var(--lyle-color-slate-500);
  font-size: 12px;
}

.result-item p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--lyle-color-slate-500);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.project-icon,
.state-icon,
.first-run-icon,
.quick-action-grid > * > span {
  display: grid;
  place-items: center;
}

.project-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--lyle-color-indigo-50);
  color: var(--lyle-color-indigo-600);
}

.project-item .item-copy > span:last-child {
  overflow: hidden;
  color: var(--lyle-color-slate-700);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-state {
  display: grid;
  min-height: 150px;
  place-items: center;
  align-content: center;
  gap: 6px;
  border: 1px dashed var(--lyle-color-slate-300);
  border-radius: 12px;
  background: var(--lyle-color-slate-50);
  color: var(--lyle-color-slate-500);
  padding: 18px;
  text-align: center;
}

.section-state strong {
  color: var(--lyle-color-slate-700);
}

.section-state span {
  font-size: 13px;
  line-height: 1.5;
}

.success-state {
  border-color: var(--lyle-color-emerald-200);
  background: color-mix(in srgb, var(--success-soft) 55%, var(--surface));
  color: var(--lyle-color-emerald-700);
}

.warning-state {
  border-color: var(--lyle-color-amber-200);
  background: color-mix(in srgb, var(--warning-soft) 55%, var(--surface));
  color: var(--lyle-color-amber-700);
}

.text-link {
  color: var(--lyle-color-indigo-600);
  font-size: 13px;
  font-weight: 700;
}

.inline-warning {
  margin: 3px 2px 0;
  color: var(--lyle-color-amber-800);
  font-size: 12px;
  line-height: 1.45;
}

.partial-warning,
.full-state {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-radius: 14px;
  padding: 16px;
}

.partial-warning {
  border: 1px solid var(--lyle-color-amber-200);
  background: var(--lyle-color-amber-50);
  color: var(--lyle-color-amber-800);
}

.partial-warning > div,
.full-state > div {
  min-width: 0;
  flex: 1;
}

.partial-warning p,
.full-state p {
  margin: 4px 0 0;
  color: var(--lyle-color-slate-600);
  line-height: 1.5;
}

.partial-warning button,
.full-state button {
  flex: 0 0 auto;
  background: var(--lyle-color-white);
  color: var(--lyle-color-slate-700);
  border: 1px solid currentColor;
}

.full-state {
  border: 1px solid var(--lyle-color-rose-200);
  background: color-mix(in srgb, var(--danger-soft) 55%, var(--surface));
}

.state-icon {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: var(--lyle-color-white);
  color: var(--lyle-color-rose-600);
}

.first-run-card {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  overflow: hidden;
  border: 1px solid var(--lyle-color-indigo-200);
  border-radius: 18px;
  background: linear-gradient(140deg, var(--lyle-color-indigo-50), var(--lyle-color-white) 68%);
  padding: clamp(22px, 4vw, 34px);
}

.first-run-icon {
  width: 50px;
  height: 50px;
  flex: 0 0 auto;
  border-radius: 14px;
  background: var(--lyle-color-indigo-600);
  color: var(--lyle-color-white);
}

.first-run-card h2 {
  font-size: clamp(1.25rem, 3vw, 1.7rem);
}

.first-run-card div > p:last-of-type {
  max-width: 720px;
  margin: 8px 0 0;
  color: var(--lyle-color-slate-500);
  line-height: 1.6;
}

.first-run-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.primary-link,
.secondary-link {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 10px;
  font-weight: 700;
  padding: 9px 14px;
}

.secondary-link {
  border: 1px solid var(--lyle-color-slate-300);
  background: var(--lyle-color-white);
  color: var(--lyle-color-slate-700);
}

.quick-actions {
  display: grid;
  gap: 15px;
}

.quick-actions > header > span {
  color: var(--lyle-color-slate-500);
  font-size: 12px;
}

.quick-action-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.quick-action-grid > * {
  display: grid;
  min-width: 0;
  grid-template-columns: 38px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 10px;
  align-items: center;
  border: 1px solid var(--lyle-color-slate-200);
  border-radius: 12px;
  background: var(--lyle-color-slate-25);
  color: var(--lyle-color-slate-700);
  padding: 12px;
  text-align: left;
}

.quick-action-grid > *:hover {
  border-color: var(--lyle-color-indigo-300);
  background: color-mix(in srgb, var(--accent) 55%, var(--surface));
}

.quick-action-grid > * > span {
  width: 38px;
  height: 38px;
  grid-row: 1 / 3;
  border-radius: 10px;
  background: var(--lyle-color-indigo-50);
  color: var(--lyle-color-indigo-600);
}

.quick-action-grid strong {
  overflow: hidden;
  color: var(--lyle-color-slate-800);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-action-grid small {
  overflow: hidden;
  color: var(--lyle-color-slate-500);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loading-grid {
  pointer-events: none;
}

.skeleton-card {
  display: grid;
  min-height: 250px;
  align-content: start;
  gap: 12px;
}

.skeleton-card span {
  height: 48px;
  border-radius: 10px;
  background: linear-gradient(90deg, var(--lyle-color-slate-100) 25%, var(--lyle-color-slate-200) 37%, var(--lyle-color-slate-100) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.3s ease infinite;
}

.skeleton-card span:first-child {
  width: 42%;
  height: 22px;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@keyframes shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .quick-action-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .dashboard-page {
    gap: 14px;
    padding-bottom: 88px;
  }

  .dashboard-header {
    align-items: flex-start;
  }

  .priority-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .priority-chip {
    min-height: 44px;
    justify-content: center;
    padding: 8px 5px;
  }

  .priority-chip strong { font-size: 18px; }
  .priority-chip span { font-size: 11px; }

  .refresh-button {
    min-width: 42px;
    padding: 10px;
  }

  .command-card,
  .panel-card,
  .quick-actions {
    border-radius: 14px;
  }

  .composer-footer {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .project-context {
    width: 100%;
    border-bottom: 1px solid var(--lyle-color-slate-100);
    padding-bottom: 7px;
  }

  .project-context select {
    width: 100%;
  }

  .shortcut-hint {
    display: none;
  }

  .send-button {
    width: 100%;
  }

  .panel-header > a {
    font-size: 12px;
  }

  .first-run-card {
    flex-direction: column;
  }

  .partial-warning,
  .full-state {
    flex-wrap: wrap;
  }

  .partial-warning button,
  .full-state button {
    width: 100%;
  }
}

@media (max-width: 420px) {
  .dashboard-header .page-description,
  .refresh-button {
    display: none;
  }

  .intent-list button {
    flex: 1 1 calc(50% - 4px);
    justify-content: center;
  }

  .list-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .list-item .tone-label {
    grid-column: 1 / -1;
  }

  .quick-action-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-card span,
  .spinning {
    animation: none;
  }

  .list-item,
  .project-item,
  .result-item {
    transition: none;
  }

  .list-item:hover,
  .project-item:hover,
  .result-item:hover {
    transform: none;
  }
}
</style>
