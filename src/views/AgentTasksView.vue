<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, RefreshCw } from '@lucide/vue'
import { listAgentTasks, type AgentTask } from '@/api/agentTasks'
import AgentTaskCard from '@/components/domain/agent/AgentTaskCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import { toAppError } from '@/api/errors'

type View = 'attention' | 'running' | 'completed' | 'failed' | 'history'
const tasks = ref<AgentTask[]>([])
const loading = ref(false)
const error = ref('')
const view = ref<View>('attention')

const tabs: Array<{ id: View; label: string }> = [
  { id: 'attention', label: '待我处理' },
  { id: 'running', label: '运行中' },
  { id: 'completed', label: '最近完成' },
  { id: 'failed', label: '失败与中断' },
  { id: 'history', label: '历史' }
]
const visible = computed(() => tasks.value.filter((task) => {
  if (view.value === 'attention') return ['AWAITING_PLAN_APPROVAL', 'AWAITING_CONFIRMATION', 'AWAITING_INPUT'].includes(task.status)
  if (view.value === 'running') return ['PLANNING', 'READY', 'RUNNING', 'PAUSING', 'PAUSED'].includes(task.status)
  if (view.value === 'completed') return ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(task.status)
  if (view.value === 'failed') return ['FAILED', 'CANCELLED'].includes(task.status)
  return true
}))

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    tasks.value = (await listAgentTasks({ limit: 100 })).data.items
  } catch (exception) {
    error.value = toAppError(exception, 'Agent Task 加载失败，请稍后重试。').message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page agent-tasks-page">
    <header class="page-heading">
      <div><span class="eyebrow">V5 · 受控执行</span><h1>Agent Task</h1><p>把多步目标交给 Lyle，在明确计划、权限和预算内持续推进。</p></div>
      <div class="heading-actions">
        <AppButton variant="secondary" size="icon" aria-label="刷新任务" :loading="loading" @click="load"><RefreshCw :size="17" /></AppButton>
        <RouterLink to="/agent-tasks/new"><AppButton><Plus :size="17" />新建任务</AppButton></RouterLink>
      </div>
    </header>

    <nav class="tabs" aria-label="Agent Task 分类">
      <button v-for="tab in tabs" :key="tab.id" :class="{ active: view === tab.id }" type="button" @click="view = tab.id">{{ tab.label }}</button>
    </nav>
    <LoadingState v-if="loading" label="正在加载 Agent Task" :cards="3" />
    <ErrorState v-else-if="error" title="任务加载失败" :message="error" @retry="load" />
    <EmptyState v-else-if="!visible.length" title="这个分类里还没有任务" description="创建一个受控任务，Lyle 会先给出可审查计划。">
      <RouterLink to="/agent-tasks/new"><AppButton>新建 Agent Task</AppButton></RouterLink>
    </EmptyState>
    <section v-else class="task-grid" :aria-label="tabs.find((tab) => tab.id === view)?.label">
      <AgentTaskCard v-for="task in visible" :key="task.id" :task="task" />
    </section>
  </div>
</template>

<style scoped>
.agent-tasks-page { max-width: 1240px; width: 100%; margin: 0 auto; }
.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
.eyebrow { color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 6px 0 4px; font-size: clamp(26px, 4vw, 36px); letter-spacing: -.03em; }
.page-heading p { max-width: 680px; margin: 0; color: var(--muted-foreground); line-height: 1.6; }
.heading-actions { display: flex; align-items: center; gap: var(--space-2); }
.heading-actions a { text-decoration: none; }
.tabs { display: flex; gap: var(--space-1); overflow-x: auto; border-bottom: 1px solid var(--border); }
.tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 10px 12px; color: var(--muted-foreground); font-size: 13px; font-weight: 650; white-space: nowrap; }
.tabs button.active { border-color: var(--primary); color: var(--primary); }
.task-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-4); }
@media (max-width: 700px) { .page-heading { flex-direction: column; } .heading-actions { width: 100%; justify-content: flex-end; } .task-grid { grid-template-columns: 1fr; } }
</style>
