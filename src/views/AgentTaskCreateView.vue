<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ShieldCheck } from '@lucide/vue'
import { cancelAgentTask, createAgentTask, generateAgentPlan, getAgentTask, type AgentTaskCreateInput } from '@/api/agentTasks'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import { toAppError } from '@/api/errors'
import { listProjects, listWorkspaces } from '@/api/app'
import type { Project } from '@/api/types'

type WorkspaceOption = { id: number; name: string; rootPath?: string; status?: string }

const router = useRouter()
const goal = ref('')
const criteriaText = ref('形成有证据的结论\n明确未完成项和建议下一步')
const forbidden = ref('')
const templateId = ref('project-inspection')
const autonomyLevel = ref<0 | 1 | 2>(1)
const workspaces = ref<WorkspaceOption[]>([])
const workspaceId = ref<number | null>(null)
const projects = ref<Project[]>([])
const projectId = ref<number | null>(null)
const workspaceLoading = ref(false)
const projectLoading = ref(false)
const writeRelativePath = ref('')
const writeContent = ref('')
const loading = ref(false)
const error = ref('')
const needsWorkspace = computed(() => ['project-inspection', 'release-check'].includes(templateId.value))
const needsProject = computed(() => ['project-inspection', 'release-check'].includes(templateId.value))
const writeTargetStarted = computed(() => Boolean(writeRelativePath.value.trim() || writeContent.value))
const writeTargetValid = computed(() => !writeTargetStarted.value || Boolean(
  autonomyLevel.value === 2 && workspaceId.value && writeRelativePath.value.trim() && writeContent.value
))
const valid = computed(() => goal.value.trim().length >= 5
  && (!needsWorkspace.value || workspaceId.value !== null)
  && (!needsProject.value || projectId.value !== null)
  && writeTargetValid.value)
let planController: AbortController | null = null
let createdTaskId: string | null = null
let cancelRequested = false

onMounted(async () => {
  workspaceLoading.value = true
  projectLoading.value = true
  try {
    const [workspaceResponse, projectResponse] = await Promise.all([listWorkspaces(), listProjects('active', 100)])
    workspaces.value = (workspaceResponse.data.items as WorkspaceOption[]).filter((item) => item.status !== 'inactive')
    workspaceId.value = workspaces.value[0]?.id ?? null
    projects.value = projectResponse.data.items
    projectId.value = projects.value[0]?.id ?? null
  } catch (exception) {
    error.value = toAppError(exception, '项目或工作区加载失败，请刷新后重试。').message
  } finally {
    workspaceLoading.value = false
    projectLoading.value = false
  }
})

async function submit() {
  if (!valid.value || loading.value) return
  loading.value = true
  error.value = ''
  cancelRequested = false
  planController = new AbortController()
  try {
    const input: AgentTaskCreateInput = {
      goal: goal.value.trim(),
      completionCriteria: criteriaText.value.split('\n').map((item) => item.trim()).filter(Boolean),
      constraints: {
        forbidden: forbidden.value.trim() ? forbidden.value.split('\n').map((item) => item.trim()).filter(Boolean) : [],
        ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
        ...(autonomyLevel.value === 2 && workspaceId.value && writeRelativePath.value.trim() && writeContent.value
          ? { writeTarget: {
              workspaceId: workspaceId.value,
              relativePath: writeRelativePath.value.trim(),
              newContent: writeContent.value
            } }
          : {})
      },
      templateId: templateId.value,
      autonomyLevel: autonomyLevel.value,
      ...(projectId.value ? { projectId: projectId.value } : {})
    }
    const created = (await createAgentTask(input)).data
    createdTaskId = created.id
    const planned = (await generateAgentPlan(created.id, created.version, planController.signal)).data
    if (cancelRequested) return
    await router.push(`/agent-tasks/${planned.id}/plan`)
  } catch (exception) {
    if (cancelRequested) return
    error.value = toAppError(exception, '任务创建或计划生成失败，请稍后重试。').message
  } finally {
    loading.value = false
    planController = null
    createdTaskId = null
  }
}

async function cancelGeneration() {
  if (!loading.value) {
    await router.push('/agent-tasks')
    return
  }
  cancelRequested = true
  planController?.abort()
  const taskId = createdTaskId
  if (taskId) {
    try {
      const current = (await getAgentTask(taskId)).data
      if (!['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)) {
        await cancelAgentTask(current.id, current.version)
      }
    } catch {
      // The generation request may still be unwinding; cancellation remains best-effort and idempotent.
    }
  }
  await router.push('/agent-tasks')
}
</script>

<template>
  <div class="page create-page">
    <RouterLink class="back" to="/agent-tasks"><ArrowLeft :size="16" />返回 Agent Task</RouterLink>
    <header><span class="eyebrow">交付一个真实目标</span><h1>新建受控任务</h1><p>先生成计划，再决定是否执行。计划批准不等于批准任何写操作。</p></header>
    <form @submit.prevent="submit">
      <AppCard class="form-card">
        <label class="field"><span>你想完成什么？</span><textarea v-model="goal" rows="6" maxlength="10000" placeholder="例如：检查 Lyle V5 是否可以发布，汇总测试失败和文档缺口；不要修改代码。" autofocus /></label>
        <label class="field"><span>完成标准 <small>每行一条</small></span><textarea v-model="criteriaText" rows="3" /></label>
        <div class="two-columns">
          <label class="field"><span>场景模板</span><select v-model="templateId"><option value="project-inspection">项目巡检</option><option value="release-check">发布检查</option><option value="research">资料调研</option></select></label>
          <label class="field"><span>自主级别</span><select v-model="autonomyLevel"><option :value="0">仅制定计划</option><option :value="1">批准后执行只读步骤</option><option :value="2">可提出写操作，逐次确认</option></select></label>
        </div>
        <label class="field"><span>目标项目 <small>{{ needsProject ? '项目巡检和发布检查必选' : '可选' }}</small></span><select v-model="projectId" :disabled="projectLoading"><option :value="null">{{ projectLoading ? '正在加载项目…' : '不绑定项目' }}</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}{{ project.currentStage ? ` · ${project.currentStage}` : '' }}</option></select><small v-if="needsProject && !projectLoading && !projectId" class="workspace-hint">请先创建一个可用项目。</small></label>
        <label class="field"><span>授权工作区 <small>{{ needsWorkspace ? '项目巡检和发布检查必选' : '可选' }}</small></span><select v-model="workspaceId" :disabled="workspaceLoading"><option :value="null">{{ workspaceLoading ? '正在加载工作区…' : '不访问本地工作区' }}</option><option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}{{ workspace.rootPath ? ` · ${workspace.rootPath}` : '' }}</option></select><small v-if="needsWorkspace && !workspaceLoading && !workspaceId" class="workspace-hint">请先在工作台注册并启用一个工作区。</small></label>
        <fieldset v-if="autonomyLevel === 2" class="write-target">
          <legend>可选文件变更目标 <small>只有目标要求修改文件时才会进入计划，执行前仍需逐次确认</small></legend>
          <label class="field"><span>工作区相对路径</span><input v-model="writeRelativePath" placeholder="例如：docs/v5-status.md" /></label>
          <label class="field"><span>确认后写入的完整内容</span><textarea v-model="writeContent" rows="4" placeholder="留空则不提出文件 Patch；填写后必须同时提供相对路径。" /></label>
          <small v-if="writeTargetStarted && !writeTargetValid" class="workspace-hint">文件变更目标需要已授权工作区、相对路径和完整内容。</small>
        </fieldset>
        <label class="field"><span>禁止事项 <small>可选，每行一条</small></span><textarea v-model="forbidden" rows="3" placeholder="例如：不改文件&#10;不访问外网" /></label>
        <aside><ShieldCheck :size="18" /><p><strong>边界不会被模型自行扩大。</strong>达到预算、权限变化或真实写入前，任务会停止并等待你。</p></aside>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer><AppButton type="button" variant="secondary" @click="cancelGeneration">{{ loading ? '取消生成' : '取消' }}</AppButton><AppButton type="submit" :loading="loading" :disabled="!valid">{{ loading ? '正在理解目标…' : '生成计划' }}</AppButton></footer>
      </AppCard>
    </form>
  </div>
</template>

<style scoped>
.create-page { width: min(820px, 100%); margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.eyebrow { color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 7px 0 5px; font-size: 32px; letter-spacing: -.03em; }
header p { margin: 0; color: var(--muted-foreground); line-height: 1.6; }
.form-card { display: grid; gap: var(--space-5); }
.field { display: grid; gap: var(--space-2); }
.field > span { font-size: 13px; font-weight: 700; }
small { color: var(--muted-foreground); font-weight: 500; }
textarea, select, input { width: 100%; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--surface); padding: 10px 12px; color: var(--foreground); font: inherit; line-height: 1.55; }
textarea { resize: vertical; }
.write-target { display: grid; gap: var(--space-3); margin: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); }.write-target legend { padding: 0 var(--space-2); font-size: 13px; font-weight: 700; }.write-target legend small { margin-left: var(--space-2); }
.two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
aside { display: flex; align-items: flex-start; gap: var(--space-3); border: 1px solid var(--info-border); border-radius: var(--radius-lg); background: var(--info-soft); padding: var(--space-3); color: var(--info-strong); }
aside p { margin: 0; font-size: 13px; line-height: 1.55; }
footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
.error { margin: 0; color: var(--danger-strong); font-size: 13px; }
@media (max-width: 640px) { .two-columns { grid-template-columns: 1fr; } footer { position: sticky; bottom: 0; margin: 0 calc(var(--space-5) * -1) calc(var(--space-5) * -1); background: var(--surface); padding: var(--space-3) var(--space-5); } }
</style>
