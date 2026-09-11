<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Blocks, ChevronDown, CircleAlert, FolderCode, GitBranch, History, LoaderCircle, Plus, Plug, RefreshCw, Settings2, Terminal, Workflow, Zap } from '@lucide/vue'
import ConnectorView from '@/views/ConnectorView.vue'
import {
  cancelWorkflowRun as cancelWorkflowRunRequest,
  checkMcpServer,
  checkAutomationTrigger as checkAutomationTriggerRequest,
  createAutomation,
  createMcpServer,
  createWorkspacePolicy,
  createWorkflow,
  createWorkflowFromPlan as createWorkflowFromPlanRequest,
  createWorkspace,
  deleteAutomation,
  deleteWorkspacePolicy,
  enableAutomation,
  getWorkflow,
  getWorkflowRun,
  invokeMcpTool,
  listAudit,
  listAgentPlans,
  listAgentTodos,
  listProjects,
  listAutomations,
  listMcpServers,
  listMcpTools,
  listAutomationRuns,
  listCommandRuns,
  listWorkflows,
  listWorkflowRuns,
  listWorkspaces,
  listWorkspacePolicies,
  pauseAutomation,
  previewCommand as previewCommandRequest,
  resumeWorkflowRun as resumeWorkflowRunRequest,
  runCommand,
  runAutomation,
  runWorkflow,
  syncMcpTools,
  retryWorkflowRun as retryWorkflowRunRequest,
  updateAutomation,
  updateMcpToolPolicy,
  updateMcpServerStatus,
  updateWorkflow
} from '@/api/app'

type Item = Record<string, any>
type WorkbenchSection = 'connectors' | 'mcp' | 'cli' | 'workflows' | 'automations' | 'runs'

const route = useRoute()
const router = useRouter()
const connectorView = ref<InstanceType<typeof ConnectorView> | null>(null)
const workbenchSections = [
  { id: 'connectors' as const, label: '数据连接', icon: Plug, description: '浏览已连接的数据来源，搜索资料并预览待确认操作。' },
  { id: 'mcp' as const, label: 'MCP 工具', icon: Blocks, description: '接入工具服务，管理可用工具与调用权限。' },
  { id: 'cli' as const, label: 'CLI 工作区', icon: Terminal, description: '选择工作区，预览命令并设置执行规则。' },
  { id: 'workflows' as const, label: '工作流', icon: GitBranch, description: '把重复的步骤保存为工作流，按需编辑和运行。' },
  { id: 'automations' as const, label: '自动化', icon: Zap, description: '为工作流设置触发条件、重试方式与失败通知。' },
  { id: 'runs' as const, label: '执行记录', icon: History, description: '查看运行详情，继续待确认步骤或排查执行问题。' }
]
const sectionAliases: Record<string, WorkbenchSection> = {
  connectors: 'connectors',
  mcp: 'mcp',
  cli: 'cli',
  workflow: 'workflows',
  workflows: 'workflows',
  automation: 'automations',
  automations: 'automations',
  runs: 'runs'
}

const loading = ref(false)
const loadError = ref('')
const actionBusy = ref(false)
const message = ref('')
const showServerEditor = ref(false)
const showWorkspaceEditor = ref(false)
const showWorkflowEditor = ref(false)
const showAutomationEditor = ref(false)
const servers = ref<Item[]>([])
const tools = ref<Item[]>([])
const workspaces = ref<Item[]>([])
const commandRuns = ref<Item[]>([])
const commandPolicies = ref<Item[]>([])
const workflows = ref<Item[]>([])
const plans = ref<Item[]>([])
const projects = ref<Item[]>([])
const todos = ref<Item[]>([])
const workflowRuns = ref<Item[]>([])
const automations = ref<Item[]>([])
const automationRuns = ref<Item[]>([])
const audit = ref<Item[]>([])
const serverName = ref('本地 MCP')
const serverType = ref('builtin')
const serverUrl = ref('')
const serverHeadersText = ref('{}')
const serverCommand = ref('')
const serverArgsText = ref('')
const serverCwd = ref('')
const serverEnvText = ref('{}')
const workspaceName = ref('')
const workspacePath = ref('')
const command = ref('git status')
const commandPolicyPattern = ref('git status*')
const commandPolicyType = ref('allow')
const commandPolicyRisk = ref('read_only')
const selectedWorkspaceId = ref<number | null>(null)
const selectedWorkflowId = ref<number | null>(null)
const selectedPlanId = ref<number | null>(null)
const commandPreview = ref<Item | null>(null)
const commandResult = ref<Item | null>(null)
const automationResult = ref<Item | null>(null)
const mcpResult = ref<Item | null>(null)
const mcpArguments = ref<Record<number, string>>({})
const pendingMcpTool = ref<Item | null>(null)
const riskOptions = ['read_only', 'write_medium', 'write_high', 'dangerous']
const workflowDraft = ref<Item>(defaultWorkflowDraft())
const workflowRunInputText = ref('{"includeSummary": true}')
const editingWorkflowId = ref<number | null>(null)
const automationName = ref('每日项目巡检自动化')
const automationTriggerType = ref('schedule')
const automationScheduleType = ref('daily')
const automationScheduleTime = ref('09:00')
const automationWeekday = ref('mon')
const automationTimezone = ref('Asia/Shanghai')
const automationMaxRetries = ref(1)
const automationRetryDelaySeconds = ref(60)
const automationNotifyOnFailure = ref(true)
const automationProjectId = ref<number | null>(null)
const automationTaskId = ref<number | null>(null)
const automationStaleHours = ref(72)
const automationDrafts = ref<Record<number, Item>>({})
const pendingAutomationDeleteId = ref<number | null>(null)
const weekdayOptions = [
  { value: 'mon', label: '周一' },
  { value: 'tue', label: '周二' },
  { value: 'wed', label: '周三' },
  { value: 'thu', label: '周四' },
  { value: 'fri', label: '周五' },
  { value: 'sat', label: '周六' },
  { value: 'sun', label: '周日' }
]
const expandedWorkflowRunId = ref<number | null>(null)
const workflowRunDetails = ref<Record<number, Item>>({})

const activeWorkspaceId = computed(() => selectedWorkspaceId.value ?? Number(workspaces.value[0]?.id || 0))
const suggestedToolId = computed(() => positiveQueryId(route.query.toolId))
const activeSection = computed<WorkbenchSection>(() => {
  const raw = String(route.query.tab || route.query.suggestion || 'mcp')
  return sectionAliases[raw] || 'mcp'
})
const currentSection = computed(() => workbenchSections.find((section) => section.id === activeSection.value)!)
const currentSectionLoading = computed(() => activeSection.value === 'connectors'
  ? Boolean(connectorView.value?.loading)
  : loading.value)

async function refreshCurrentSection() {
  if (activeSection.value === 'connectors') {
    await connectorView.value?.refresh()
  } else {
    await refreshAll()
  }
}

watch(() => route.query.action, (action) => {
  if (action === 'add-workspace') showWorkspaceEditor.value = true
  if (action === 'add-mcp') showServerEditor.value = true
}, { immediate: true })

async function performAction(action: () => Promise<unknown>) {
  if (actionBusy.value) return
  actionBusy.value = true
  message.value = ''
  try {
    await action()
  } catch (error: any) {
    message.value = error?.response?.data?.message || error?.response?.data?.detail || error?.message || '操作未完成，请稍后重试。'
  } finally {
    actionBusy.value = false
  }
}

async function selectSection(section: WorkbenchSection) {
  await router.replace({ path: '/advanced-settings', query: { tab: section } })
}

function positiveQueryId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

async function refreshAll() {
  loading.value = true
  loadError.value = ''
  try {
    const [serverResponse, toolResponse, workspaceResponse, workflowResponse, workflowRunResponse, automationResponse, auditResponse, planResponse, projectResponse, todoResponse] = await Promise.all([
      listMcpServers(),
      listMcpTools(),
      listWorkspaces(),
      listWorkflows(),
      listWorkflowRuns(20),
      listAutomations(),
      listAudit(50),
      listAgentPlans(undefined, undefined, 100),
      listProjects('active', 100),
      listAgentTodos(100)
    ])
    servers.value = serverResponse.data.items
    tools.value = toolResponse.data.items
    workspaces.value = workspaceResponse.data.items
    workflows.value = workflowResponse.data.items
    plans.value = planResponse.data.items
    projects.value = projectResponse.data.items
    todos.value = todoResponse.data.items.filter((todo: Item) => todo.status === 'open' && todo.dueAt)
    workflowRuns.value = workflowRunResponse.data.items
    if (activeWorkspaceId.value) {
      const [runResponse, policyResponse] = await Promise.all([
        listCommandRuns(activeWorkspaceId.value, 20),
        listWorkspacePolicies(activeWorkspaceId.value)
      ])
      commandRuns.value = runResponse.data.items
      commandPolicies.value = policyResponse.data.items
    } else {
      commandRuns.value = []
      commandPolicies.value = []
    }
    automations.value = automationResponse.data.items
    automationDrafts.value = Object.fromEntries(
      automations.value.map((automation) => [Number(automation.id), automationDraftFrom(automation)])
    )
    if (automations.value[0]?.id) {
      automationRuns.value = (await listAutomationRuns(Number(automations.value[0].id), 10)).data.items
    } else {
      automationRuns.value = []
    }
    audit.value = auditResponse.data.items
  } catch (error: any) {
    loadError.value = error?.response?.data?.message || error?.response?.data?.detail || '高级设置数据加载失败'
  } finally {
    loading.value = false
  }
}

async function addServer() {
  if (!serverName.value.trim()) throw new Error('请填写服务名称。')
  let configRef: Item | undefined
  if (serverType.value === 'streamable_http') {
    if (!serverUrl.value.trim()) throw new Error('请填写 MCP 服务地址。')
    configRef = { url: serverUrl.value.trim(), headers: parseStrictJsonObject(serverHeadersText.value, 'HTTP Headers') }
  } else if (serverType.value === 'stdio') {
    if (!serverCommand.value.trim()) throw new Error('请填写 MCP 启动命令。')
    configRef = {
      command: serverCommand.value.trim(),
      args: serverArgsText.value.split('\n').map((item) => item.trim()).filter(Boolean),
      cwd: serverCwd.value || undefined,
      env: parseStrictJsonObject(serverEnvText.value, '环境变量')
    }
  }
  const created = await createMcpServer({
    name: serverName.value.trim(),
    serverType: serverType.value,
    configRef,
    status: 'enabled'
  })
  if (serverType.value === 'builtin') {
    await syncMcpTools(Number(created.data.id), [
      {
        toolName: 'workspace.git_status',
        description: '读取本地工作区 Git 状态',
        riskLevel: 'read_only',
        inputSchema: { type: 'object', properties: { workspaceId: { type: 'number' } } }
      },
      {
        toolName: 'workspace.rg_todo',
        description: '检索本地工作区 TODO',
        riskLevel: 'read_only',
        inputSchema: { type: 'object', properties: { workspaceId: { type: 'number' } } }
      }
    ])
    message.value = '内置 MCP Server 已注册'
  } else {
    const health = (await checkMcpServer(Number(created.data.id))).data
    if (health.lastHealthStatus === 'ok') {
      const synced = await syncMcpTools(Number(created.data.id))
      message.value = `外部 MCP 已连接，发现 ${synced.data.items.length} 个工具`
    } else {
      message.value = String(health.lastHealthMessage || 'MCP Server 连接失败')
    }
  }
  await refreshAll()
  showServerEditor.value = false
}

async function addWorkspace() {
  if (!workspaceName.value.trim() || !workspacePath.value.trim()) throw new Error('请填写工作区名称和项目目录。')
  await createWorkspace({ name: workspaceName.value.trim(), rootPath: workspacePath.value.trim(), status: 'active' })
  message.value = '工作区已注册'
  await refreshAll()
  showWorkspaceEditor.value = false
}

async function previewCommand() {
  if (!activeWorkspaceId.value) return
  commandPreview.value = (await previewCommandRequest(activeWorkspaceId.value, command.value)).data
}

async function invokeTool(tool: Item, confirmed = false, secondConfirmed = false) {
  const server = servers.value.find((item) => Number(item.id) === Number(tool.serverId))
  const argumentsPayload = server?.serverType === 'builtin'
    ? { workspaceId: activeWorkspaceId.value }
    : parseStrictJsonObject(mcpArguments.value[Number(tool.id)] || '{}', '工具参数')
  mcpResult.value = (await invokeMcpTool(Number(tool.id), {
    arguments: argumentsPayload,
    confirmed,
    secondConfirmed
  })).data
  pendingMcpTool.value = mcpResult.value.requiresConfirmation ? tool : null
  message.value = mcpResult.value.requiresConfirmation ? `${tool.toolName} 等待确认` : `已调用 ${tool.toolName}`
  await refreshAll()
}

async function confirmMcpInvocation() {
  if (!pendingMcpTool.value || !mcpResult.value?.requiresConfirmation) return
  await invokeTool(pendingMcpTool.value, true, Boolean(mcpResult.value.requiresSecondConfirmation))
}

async function checkServer(server: Item) {
  const result = (await checkMcpServer(Number(server.id))).data
  message.value = String(result.lastHealthMessage || '健康检查完成')
  await refreshAll()
}

async function toggleServer(server: Item) {
  const status = server.status === 'enabled' ? 'disabled' : 'enabled'
  await updateMcpServerStatus(Number(server.id), status)
  message.value = `${server.name} 已${status === 'enabled' ? '启用' : '停用'}`
  await refreshAll()
}

async function syncServer(server: Item) {
  if (server.serverType === 'builtin') return
  const result = await syncMcpTools(Number(server.id))
  message.value = `${server.name} 已同步 ${result.data.items.length} 个工具`
  await refreshAll()
}

async function saveToolPolicy(tool: Item) {
  await updateMcpToolPolicy(Number(tool.id), {
    riskLevel: tool.riskLevel,
    enabled: Boolean(tool.enabled)
  })
  message.value = `${tool.toolName} 权限策略已更新`
  await refreshAll()
}

async function executeCommand(confirmed = false) {
  if (!activeWorkspaceId.value) return
  commandResult.value = (await runCommand(activeWorkspaceId.value, command.value, confirmed)).data
  await refreshAll()
}

async function executeCommandWithSecondConfirmation() {
  if (!activeWorkspaceId.value) return
  commandResult.value = (await runCommand(activeWorkspaceId.value, command.value, true, true)).data
  await refreshAll()
}

async function loadCommandRuns() {
  if (!activeWorkspaceId.value) return
  commandRuns.value = (await listCommandRuns(activeWorkspaceId.value, 20)).data.items
}

async function loadWorkspaceDetails() {
  commandPreview.value = null
  commandResult.value = null
  if (!activeWorkspaceId.value) return
  const [runResponse, policyResponse] = await Promise.all([
    listCommandRuns(activeWorkspaceId.value, 20),
    listWorkspacePolicies(activeWorkspaceId.value)
  ])
  commandRuns.value = runResponse.data.items
  commandPolicies.value = policyResponse.data.items
}

async function addCommandPolicy() {
  if (!activeWorkspaceId.value) return
  await createWorkspacePolicy(activeWorkspaceId.value, {
    commandPattern: commandPolicyPattern.value,
    policy: commandPolicyType.value,
    riskLevel: commandPolicyRisk.value,
    requiresConfirmation: commandPolicyType.value === 'confirm'
  })
  message.value = '工作区命令策略已添加'
  await loadWorkspaceDetails()
}

async function removeCommandPolicy(policy: Item) {
  if (!activeWorkspaceId.value) return
  await deleteWorkspacePolicy(activeWorkspaceId.value, Number(policy.id))
  message.value = '工作区命令策略已删除'
  await loadWorkspaceDetails()
}

async function createDailyWorkflow() {
  workflowDraft.value = {
    name: '每日项目巡检',
    description: '读取项目状态并生成工作区巡检结果',
    steps: [
      { title: '读取 Git 状态', stepType: 'cli', commandTemplate: 'git status' },
      { title: '检索 TODO', stepType: 'cli', commandTemplate: 'rg TODO' },
      { title: '汇总结果', stepType: 'summarize' }
    ]
  }
  editingWorkflowId.value = null
  await saveWorkflowDraft()
}

async function createWorkflowFromPlan() {
  const planId = selectedPlanId.value ?? Number(plans.value[0]?.id || 0)
  if (!planId) return
  const workflow = (await createWorkflowFromPlanRequest(planId)).data
  editingWorkflowId.value = Number(workflow.id)
  selectedWorkflowId.value = Number(workflow.id)
  workflowDraft.value = workflowDraftFrom(workflow)
  message.value = '计划已保存为可编辑工作流'
  await refreshAll()
}

async function loadWorkflowEditor() {
  const workflowId = selectedWorkflowId.value ?? Number(workflows.value[0]?.id || 0)
  if (!workflowId) return
  const workflow = (await getWorkflow(workflowId)).data
  editingWorkflowId.value = workflowId
  workflowDraft.value = workflowDraftFrom(workflow)
  showWorkflowEditor.value = true
  message.value = `${workflow.name} 已载入编辑器`
}

async function saveWorkflowDraft() {
  const payload = {
    name: workflowDraft.value.name,
    description: workflowDraft.value.description,
    status: workflowDraft.value.status || 'active',
    triggerType: workflowDraft.value.triggerType || 'manual',
    steps: workflowDraft.value.steps.map((step: Item, index: number) => ({
      title: step.title,
      stepType: step.stepType,
      toolName: step.toolName,
      commandTemplate: step.commandTemplate,
      inputTemplate: parseJsonObject(step.inputTemplateText),
      outputKey: step.outputKey || `step_${index + 1}`,
      condition: step.conditionPath
        ? {
            path: step.conditionPath,
            operator: step.conditionOperator || 'truthy',
            value: parseJsonValue(step.conditionValueText)
          }
        : null,
      requiresConfirmation: Boolean(step.requiresConfirmation),
      sortOrder: index
    }))
  }
  const workflow = editingWorkflowId.value
    ? (await updateWorkflow(editingWorkflowId.value, payload)).data
    : (await createWorkflow(payload)).data
  editingWorkflowId.value = Number(workflow.id)
  selectedWorkflowId.value = Number(workflow.id)
  workflowDraft.value = workflowDraftFrom(workflow)
  message.value = '工作流已保存'
  await refreshAll()
}

function resetWorkflowDraft() {
  editingWorkflowId.value = null
  workflowDraft.value = defaultWorkflowDraft()
  showWorkflowEditor.value = true
}

function addWorkflowStep(stepType = 'cli') {
  workflowDraft.value.steps.push(defaultWorkflowStep(stepType))
}

function removeWorkflowStep(index: number) {
  workflowDraft.value.steps.splice(index, 1)
}

function moveWorkflowStep(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= workflowDraft.value.steps.length) return
  const steps = workflowDraft.value.steps
  const [step] = steps.splice(index, 1)
  steps.splice(target, 0, step)
}

async function runSelectedWorkflow() {
  const workflowId = selectedWorkflowId.value ?? Number(workflows.value[0]?.id || 0)
  if (!workflowId || !activeWorkspaceId.value) return
  const run = (await runWorkflow(workflowId, {
    workspaceId: activeWorkspaceId.value,
    input: parseStrictJsonObject(workflowRunInputText.value, '工作流运行输入')
  })).data
  commandResult.value = run
  workflowRunDetails.value[Number(run.id)] = run
  expandedWorkflowRunId.value = Number(run.id)
  message.value = '工作流已运行'
  await refreshAll()
}

async function toggleWorkflowRun(run: Item) {
  const runId = Number(run.id)
  if (expandedWorkflowRunId.value === runId) {
    expandedWorkflowRunId.value = null
    return
  }
  expandedWorkflowRunId.value = runId
  if (!workflowRunDetails.value[runId]) {
    workflowRunDetails.value[runId] = (await getWorkflowRun(runId)).data
  }
}

async function resumeWorkflowRun(run: Item, secondConfirmed = false) {
  const result = (await resumeWorkflowRunRequest(Number(run.id), secondConfirmed)).data
  workflowRunDetails.value[Number(run.id)] = result
  expandedWorkflowRunId.value = Number(run.id)
  message.value = result.status === 'completed' ? '工作流已继续并完成' : '工作流仍在等待二次确认'
  await refreshAll()
}

async function retryWorkflowRun(run: Item) {
  const result = (await retryWorkflowRunRequest(Number(run.id))).data
  workflowRunDetails.value[Number(run.id)] = result
  expandedWorkflowRunId.value = Number(run.id)
  message.value = result.status === 'completed' ? '工作流重试完成' : `工作流重试后状态：${result.status}`
  await refreshAll()
}

async function cancelWorkflowRun(run: Item) {
  const result = (await cancelWorkflowRunRequest(Number(run.id))).data
  workflowRunDetails.value[Number(run.id)] = result
  expandedWorkflowRunId.value = Number(run.id)
  message.value = '工作流已取消'
  await refreshAll()
}

function workflowNeedsSecondConfirmation(run: Item) {
  const detail = workflowRunDetails.value[Number(run.id)]
  return Boolean(detail?.steps?.some((step: Item) =>
    step.status === 'awaiting_confirmation' && step.output?.requiresSecondConfirmation
  ))
}

async function createAutomationRule() {
  const workflowId = selectedWorkflowId.value ?? Number(workflows.value[0]?.id || 0)
  if (!workflowId) return
  await createAutomation({
    workflowId,
    name: automationName.value,
    triggerType: automationTriggerType.value,
    scheduleExpr: automationTriggerType.value === 'schedule'
      ? buildScheduleExpr(automationScheduleType.value, automationScheduleTime.value, automationWeekday.value)
      : undefined,
    timezone: automationTimezone.value,
    status: 'paused',
    input: buildAutomationInput(
      automationTriggerType.value,
      activeWorkspaceId.value,
      automationProjectId.value,
      automationTaskId.value,
      automationStaleHours.value
    ),
    maxRetries: automationMaxRetries.value,
    retryDelaySeconds: automationRetryDelaySeconds.value,
    notifyOnFailure: automationNotifyOnFailure.value
  })
  message.value = '自动化规则已创建'
  await refreshAll()
  showAutomationEditor.value = false
}

async function saveAutomationConfig(automation: Item) {
  const draft = automationDrafts.value[Number(automation.id)]
  if (!draft) return
  await updateAutomation(Number(automation.id), {
    name: draft.name,
    workflowId: automation.workflowId,
    triggerType: draft.triggerType,
    scheduleExpr: draft.triggerType === 'schedule'
      ? buildScheduleExpr(draft.scheduleType, draft.scheduleTime, draft.weekday)
      : undefined,
    timezone: draft.timezone,
    status: draft.status,
    input: buildAutomationInput(
      draft.triggerType,
      Number(automation.input?.workspaceId || activeWorkspaceId.value || 0) || null,
      Number(draft.projectId || 0) || null,
      Number(draft.taskId || 0) || null,
      Number(draft.staleHours || 72)
    ),
    maxRetries: Number(draft.maxRetries || 0),
    retryDelaySeconds: Number(draft.retryDelaySeconds || 60),
    notifyOnFailure: Boolean(draft.notifyOnFailure)
  })
  message.value = `${draft.name} 调度配置已保存`
  await refreshAll()
}

async function runAutomationOnce(automation: Item) {
  automationResult.value = (await runAutomation(Number(automation.id), activeWorkspaceId.value ? { workspaceId: activeWorkspaceId.value } : {})).data
  message.value = '自动化已运行一次'
  await refreshAll()
}

async function checkAutomationTrigger(automation: Item) {
  const result = (await checkAutomationTriggerRequest(Number(automation.id))).data
  message.value = result.triggered ? '事件已匹配并执行自动化' : String(result.reason || '当前没有匹配事件')
  await refreshAll()
}

async function loadAutomationRuns(automation: Item) {
  automationRuns.value = (await listAutomationRuns(Number(automation.id), 20)).data.items
  await selectSection('runs')
}

async function setAutomation(automation: Item, enabled: boolean) {
  if (enabled) {
    await enableAutomation(Number(automation.id))
  } else {
    await pauseAutomation(Number(automation.id))
  }
  await refreshAll()
}

function requestAutomationDelete(automation: Item) {
  pendingAutomationDeleteId.value = Number(automation.id)
}

async function confirmAutomationDelete(automation: Item) {
  await deleteAutomation(Number(automation.id))
  pendingAutomationDeleteId.value = null
  message.value = `${automation.name} 已删除`
  await refreshAll()
}

function buildScheduleExpr(scheduleType: string, scheduleTime = '09:00', weekday = 'mon') {
  if (scheduleType === 'hourly') return 'hourly'
  if (scheduleType === 'weekly') return `weekly:${weekday}@${scheduleTime || '09:00'}`
  return `daily@${scheduleTime || '09:00'}`
}

function buildAutomationInput(
  triggerType: string,
  workspaceId: number | null,
  projectId: number | null,
  taskId: number | null,
  staleHours: number
) {
  const input: Item = workspaceId ? { workspaceId } : {}
  if (triggerType === 'project_stale') {
    input.projectId = projectId
    input.staleHours = staleHours
  } else if (triggerType === 'task_due') {
    input.taskId = taskId
  }
  return input
}

function automationDraftFrom(automation: Item) {
  const parsed = parseScheduleExpr(String(automation.scheduleExpr || 'daily@09:00'))
  return {
    name: automation.name,
    status: automation.status,
    triggerType: automation.triggerType || 'schedule',
    timezone: automation.timezone || 'Asia/Shanghai',
    projectId: automation.input?.projectId || null,
    taskId: automation.input?.taskId || null,
    staleHours: Number(automation.input?.staleHours || 72),
    maxRetries: Number(automation.maxRetries || 0),
    retryDelaySeconds: Number(automation.retryDelaySeconds || 60),
    notifyOnFailure: Boolean(automation.notifyOnFailure),
    ...parsed
  }
}

function parseScheduleExpr(scheduleExpr: string) {
  if (scheduleExpr === 'hourly') return { scheduleType: 'hourly', scheduleTime: '09:00', weekday: 'mon' }
  if (scheduleExpr.startsWith('weekly:')) {
    const rest = scheduleExpr.split(':', 2)[1]
    const [weekday = 'mon', time = '09:00'] = rest.split('@')
    return { scheduleType: 'weekly', scheduleTime: time, weekday }
  }
  if (scheduleExpr.startsWith('daily@')) {
    return { scheduleType: 'daily', scheduleTime: scheduleExpr.split('@', 2)[1] || '09:00', weekday: 'mon' }
  }
  if (scheduleExpr === 'weekly') return { scheduleType: 'weekly', scheduleTime: '09:00', weekday: 'mon' }
  return { scheduleType: 'daily', scheduleTime: '09:00', weekday: 'mon' }
}

function defaultWorkflowDraft() {
  return {
    name: '自定义工作流',
    description: '',
    status: 'active',
    triggerType: 'manual',
    steps: [
      defaultWorkflowStep('cli'),
      defaultWorkflowStep('summarize')
    ]
  }
}

function defaultWorkflowStep(stepType = 'cli') {
  if (stepType === 'mcp_tool') {
    return {
      title: '调用 MCP 工具',
      stepType,
      toolName: tools.value[0]?.toolName || 'workspace.git_status',
      commandTemplate: '',
      inputTemplateText: '{}',
      outputKey: '',
      conditionPath: '',
      conditionOperator: 'truthy',
      conditionValueText: 'true',
      requiresConfirmation: false
    }
  }
  if (stepType === 'summarize') {
    return {
      title: '汇总结果',
      stepType,
      toolName: '',
      commandTemplate: '',
      inputTemplateText: '{}',
      outputKey: '',
      conditionPath: '',
      conditionOperator: 'truthy',
      conditionValueText: 'true',
      requiresConfirmation: false
    }
  }
  return {
    title: '执行命令',
    stepType: 'cli',
    toolName: '',
    commandTemplate: 'git status',
    inputTemplateText: '{}',
    outputKey: '',
    conditionPath: '',
    conditionOperator: 'truthy',
    conditionValueText: 'true',
    requiresConfirmation: false
  }
}

function workflowDraftFrom(workflow: Item) {
  return {
    name: workflow.name || '',
    description: workflow.description || '',
    status: workflow.status || 'active',
    triggerType: workflow.triggerType || 'manual',
    steps: (workflow.steps || []).map((step: Item) => ({
      title: step.title || '',
      stepType: step.stepType || 'summarize',
      toolName: step.toolName || '',
      commandTemplate: step.commandTemplate || '',
      inputTemplateText: JSON.stringify(step.inputTemplate || {}, null, 2),
      outputKey: step.outputKey || '',
      conditionPath: step.condition?.path || '',
      conditionOperator: step.condition?.operator || 'truthy',
      conditionValueText: JSON.stringify(step.condition?.value ?? true),
      requiresConfirmation: Boolean(step.requiresConfirmation)
    }))
  }
}

function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonValue(text: string) {
  if (!text?.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function parseStrictJsonObject(text: string, label: string) {
  try {
    const parsed = JSON.parse(text || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    message.value = `${label} 必须是有效的 JSON 对象`
    throw new Error(message.value)
  }
}

onMounted(async () => {
  await refreshAll()
  const workspaceId = positiveQueryId(route.query.workspaceId)
  if (workspaceId && workspaces.value.some((item) => Number(item.id) === workspaceId)) {
    selectedWorkspaceId.value = workspaceId
    await loadWorkspaceDetails()
  }
})
</script>

<template>
  <div class="page workbench-page">
    <header class="workbench-header">
      <div>
        <h1>高级设置</h1>
        <p>按你的工作方式，配置工具、权限与运行规则。</p>
      </div>
      <button class="secondary refresh-action" type="button" :disabled="currentSectionLoading || actionBusy" @click="refreshCurrentSection"><RefreshCw :size="16" :class="{ spinning: currentSectionLoading }" />刷新</button>
    </header>

    <div v-if="message" class="notice" role="status">{{ message }}</div>

    <nav class="workbench-tabs" aria-label="工具分区">
      <button
        v-for="section in workbenchSections"
        :key="section.id"
        type="button"
        :class="{ active: activeSection === section.id }"
        :aria-pressed="activeSection === section.id"
        :data-testid="`workbench-tab-${section.id}`"
        @click="selectSection(section.id)"
      ><component :is="section.icon" :size="18" /><span>{{ section.label }}</span></button>
    </nav>

    <div class="workbench-section-heading">
      <div><h2>{{ currentSection.label }}</h2><p>{{ currentSection.description }}</p></div>
      <button v-if="activeSection === 'mcp'" type="button" :disabled="loading || actionBusy" :aria-expanded="showServerEditor" aria-controls="mcp-registration" @click="showServerEditor = !showServerEditor"><Plus :size="16" />{{ showServerEditor ? '收起配置' : '添加服务' }}</button>
      <button v-if="activeSection === 'cli'" type="button" :disabled="loading || actionBusy" :aria-expanded="showWorkspaceEditor" aria-controls="workspace-registration" @click="showWorkspaceEditor = !showWorkspaceEditor"><Plus :size="16" />{{ showWorkspaceEditor ? '收起配置' : '添加工作区' }}</button>
      <button v-if="activeSection === 'workflows'" type="button" :disabled="loading || actionBusy" :aria-expanded="showWorkflowEditor" @click="showWorkflowEditor ? showWorkflowEditor = false : resetWorkflowDraft()"><Plus :size="16" />{{ showWorkflowEditor ? '收起编辑器' : '新建工作流' }}</button>
      <button v-if="activeSection === 'automations'" type="button" :disabled="loading || actionBusy" :aria-expanded="showAutomationEditor" aria-controls="automation-registration" @click="showAutomationEditor = !showAutomationEditor"><Plus :size="16" />{{ showAutomationEditor ? '收起配置' : '新建规则' }}</button>
      <RouterLink v-if="activeSection === 'runs'" class="text-link" to="/execution-center">前往执行中心<ArrowRight :size="15" /></RouterLink>
    </div>

    <ConnectorView v-if="activeSection === 'connectors'" ref="connectorView" embedded />
    <div v-else-if="loading" class="workbench-loading" role="status"><LoaderCircle class="spinning" :size="22" /><span>正在加载{{ currentSection.label }}…</span></div>
    <div v-else-if="loadError" class="workbench-error" role="alert"><CircleAlert :size="24" /><h3>暂时无法加载设置</h3><p>{{ loadError }}</p><button class="secondary" type="button" @click="refreshAll">重新加载</button></div>

    <fieldset v-else class="workbench-content" :disabled="actionBusy">

    <section v-if="(activeSection === 'mcp' && showServerEditor) || activeSection === 'cli' || (activeSection === 'workflows' && showWorkflowEditor) || (activeSection === 'automations' && showAutomationEditor)" class="grid workbench-grid">
      <div v-if="activeSection === 'mcp' && showServerEditor" id="mcp-registration" class="item stack editor-panel wide">
        <div class="section-title">
          <h2>添加 MCP 服务</h2>
          <span class="muted">选择连接方式并填写服务信息</span>
        </div>
        <label class="field"><span>MCP Server 名称</span><input v-model="serverName" aria-label="MCP Server 名称"></label>
        <label class="field"><span>MCP 连接类型</span><select v-model="serverType" aria-label="MCP 连接类型">
          <option value="builtin">内置</option>
          <option value="streamable_http">Streamable HTTP</option>
          <option value="stdio">stdio</option>
        </select></label>
        <template v-if="serverType === 'streamable_http'">
          <label class="field"><span>MCP Server URL</span><input v-model="serverUrl" aria-label="MCP Server URL" placeholder="http://127.0.0.1:3000/mcp"></label>
          <label class="field"><span>MCP HTTP Headers</span><textarea v-model="serverHeadersText" aria-label="MCP HTTP Headers" rows="3" placeholder='{"Authorization":"Bearer ..."}'></textarea></label>
        </template>
        <template v-if="serverType === 'stdio'">
          <label class="field"><span>MCP 启动命令</span><input v-model="serverCommand" aria-label="MCP 启动命令" placeholder="npx"></label>
          <label class="field"><span>MCP 启动参数</span><textarea v-model="serverArgsText" aria-label="MCP 启动参数" rows="4" placeholder="每行一个参数"></textarea></label>
          <label class="field"><span>MCP 工作目录（选填）</span><input v-model="serverCwd" aria-label="MCP 工作目录" placeholder="服务运行环境中的绝对路径"></label>
          <label class="field"><span>MCP 环境变量</span><textarea v-model="serverEnvText" aria-label="MCP 环境变量" rows="3" placeholder='{"GITHUB_TOKEN":"..."}'></textarea></label>
        </template>
        <div class="row"><button type="button" :disabled="!serverName.trim() || (serverType === 'streamable_http' && !serverUrl.trim()) || (serverType === 'stdio' && !serverCommand.trim())" @click="performAction(() => addServer())">添加服务</button><button class="secondary" type="button" @click="showServerEditor = false">取消</button></div>
      </div>
      <div v-if="activeSection === 'cli' && showWorkspaceEditor" id="workspace-registration" class="item wide stack editor-panel">
        <div class="section-title">
          <h2>添加工作区</h2>
          <span class="muted">填写运行环境中的项目目录</span>
        </div>
        <div class="row workspace-registration-form">
          <label class="field"><span>工作区名称</span><input v-model="workspaceName" aria-label="工作区名称" placeholder="例如：产品项目"></label>
          <label class="field"><span>工作区路径</span><input v-model="workspacePath" aria-label="工作区路径" placeholder="运行环境中的项目绝对路径"></label>
          <button type="button" :disabled="!workspaceName.trim() || !workspacePath.trim()" @click="performAction(() => addWorkspace())">添加工作区</button>
        </div>
      </div>
      <div v-if="activeSection === 'cli' && !workspaces.length && !showWorkspaceEditor" class="item wide empty-panel"><span class="empty-icon"><FolderCode :size="26" /></span><h3>从一个工作区开始</h3><p>添加项目目录后，就可以预览命令、运行检查并管理执行规则。</p><button class="secondary" type="button" @click="showWorkspaceEditor = true"><Plus :size="15" />添加工作区</button></div>
      <div v-if="activeSection === 'cli' && workspaces.length" class="item wide stack">
        <div class="section-title"><h2>运行命令</h2><span class="muted">{{ workspaces.length }} 个工作区</span></div>
        <div class="row">
          <label class="field"><span>选择工作区</span><select v-model.number="selectedWorkspaceId" class="inline-input" aria-label="选择工作区" @change="loadWorkspaceDetails">
            <option :value="null">默认工作区</option>
            <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
              {{ workspace.name }}
            </option>
          </select></label>
          <label class="field"><span>命令</span><input v-model="command" aria-label="命令"></label>
          <button class="secondary" type="button" @click="performAction(() => previewCommand())">预览</button>
          <button type="button" @click="performAction(() => executeCommand(false))">执行</button>
          <button class="secondary" type="button" @click="performAction(() => loadCommandRuns())">记录</button>
        </div>
        <details class="config-details"><summary><Settings2 :size="16" />命令规则<span>{{ commandPolicies.length }} 条规则</span><ChevronDown :size="15" /></summary><div class="row command-policy-editor">
          <label class="field"><span>命令规则</span><input v-model="commandPolicyPattern" aria-label="命令规则" placeholder="例如 git status*"></label>
          <label class="field"><span>命令策略</span><select v-model="commandPolicyType" aria-label="命令策略">
            <option value="allow">允许</option>
            <option value="confirm">需确认</option>
            <option value="deny">禁止</option>
          </select></label>
          <label class="field"><span>策略风险等级</span><select v-model="commandPolicyRisk" aria-label="策略风险等级">
            <option v-for="risk in riskOptions" :key="risk" :value="risk">{{ risk }}</option>
          </select></label>
          <button class="secondary" type="button" @click="performAction(() => addCommandPolicy())">添加规则</button>
        </div>
        <div v-if="commandPolicies.length" class="command-history">
          <div v-for="policy in commandPolicies" :key="policy.id" class="command-row">
            <span>{{ policy.commandPattern }}</span>
            <span class="badge" :class="{ danger: policy.policy === 'deny' }">{{ policy.policy }}</span>
            <span class="muted">{{ policy.riskLevel }}</span>
            <button class="secondary" type="button" aria-label="删除命令策略" @click="performAction(() => removeCommandPolicy(policy))">删除</button>
          </div>
        </div>
        <p v-else class="inline-empty">尚未添加自定义规则，命令仍按当前默认策略执行。</p>
        </details>
        <div v-if="commandResult?.requiresConfirmation" class="notice command-confirmation">
          <span>
            {{ commandResult.requiresSecondConfirmation ? '该命令需要二次确认。' : '该命令需要确认后执行。' }}
          </span>
          <button
            v-if="commandResult.requiresSecondConfirmation"
            class="danger-confirm"
            type="button"
            @click="performAction(() => executeCommandWithSecondConfirmation())"
          >
            二次确认执行
          </button>
          <button v-else type="button" @click="performAction(() => executeCommand(true))">确认执行</button>
        </div>
        <pre v-if="commandPreview">{{ JSON.stringify(commandPreview, null, 2) }}</pre>
        <pre v-if="commandResult">{{ JSON.stringify(commandResult, null, 2) }}</pre>
        <div v-if="commandRuns.length" class="command-history">
          <div v-for="run in commandRuns" :key="run.id" class="command-row">
            <span>{{ run.command }}</span>
            <span class="badge" :class="{ success: run.status === 'completed', danger: run.status === 'failed' }">{{ run.status }}</span>
            <span class="muted">{{ run.riskLevel }} / exit {{ run.exitCode ?? '-' }}</span>
            <span>{{ run.summary }}</span>
          </div>
        </div>
        <p v-else class="inline-empty">还没有命令记录。运行后可在这里查看结果。</p>
      </div>
      <div v-if="activeSection === 'workflows' && showWorkflowEditor" class="item wide stack editor-panel">
        <div class="section-title"><h2>{{ editingWorkflowId ? '编辑工作流' : '新建工作流' }}</h2></div>
        <div class="row">
          <label class="field"><span>来源计划</span><select v-model.number="selectedPlanId" aria-label="来源计划">
            <option :value="null">选择来源计划</option>
            <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.title }}</option>
          </select></label>
          <button class="secondary" type="button" :disabled="!plans.length" @click="performAction(() => createWorkflowFromPlan())">保存为工作流</button>
        </div>
        <label class="field"><span>选择工作流</span><select v-model.number="selectedWorkflowId" aria-label="选择工作流">
          <option :value="null">默认工作流</option>
          <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">
            {{ workflow.name }}
          </option>
        </select></label>
        <div class="row">
          <button type="button" @click="performAction(() => createDailyWorkflow())">创建巡检</button>
          <button class="secondary" type="button" :disabled="!workflows.length" @click="performAction(() => loadWorkflowEditor())">载入编辑</button>
          <button class="secondary" type="button" @click="resetWorkflowDraft">新建草稿</button>
          <button type="button" @click="performAction(() => saveWorkflowDraft())">保存工作流</button>
          <button class="secondary" type="button" :disabled="!workflows.length || !activeWorkspaceId" @click="performAction(() => runSelectedWorkflow())">运行</button>
        </div>
        <label class="field"><span>工作流运行输入</span><textarea v-model="workflowRunInputText" aria-label="工作流运行输入" rows="2"></textarea></label>
        <div class="workflow-editor">
          <label class="field"><span>工作流名称</span><input v-model="workflowDraft.name" aria-label="工作流名称"></label>
          <label class="field"><span>工作流描述</span><textarea v-model="workflowDraft.description" aria-label="工作流描述" rows="2"></textarea></label>
          <div class="row">
            <button class="secondary" type="button" @click="addWorkflowStep('cli')">添加 CLI</button>
            <button class="secondary" type="button" @click="addWorkflowStep('mcp_tool')">添加 MCP</button>
            <button class="secondary" type="button" @click="addWorkflowStep('summarize')">添加汇总</button>
          </div>
          <div v-for="(step, index) in workflowDraft.steps" :key="index" class="workflow-step-editor">
            <div class="section-title">
              <span>步骤 {{ index + 1 }}</span>
              <span class="row">
                <button class="secondary" type="button" @click="moveWorkflowStep(index, -1)">上移</button>
                <button class="secondary" type="button" @click="moveWorkflowStep(index, 1)">下移</button>
                <button class="secondary" type="button" @click="removeWorkflowStep(index)">删除</button>
              </span>
            </div>
            <div class="workflow-step-grid">
              <label class="field"><span>步骤标题</span><input v-model="step.title" aria-label="步骤标题"></label>
              <label class="field"><span>步骤输出键</span><input v-model="step.outputKey" aria-label="步骤输出键" :placeholder="`step_${index + 1}`"></label>
              <label class="field"><span>步骤类型</span><select v-model="step.stepType" aria-label="步骤类型">
                <option value="cli">CLI</option>
                <option value="mcp_tool">MCP</option>
                <option value="summarize">汇总</option>
              </select></label>
              <label class="toggle-line">
                <input v-model="step.requiresConfirmation" type="checkbox">
                需确认
              </label>
            </div>
            <div class="workflow-step-grid">
              <label class="field"><span>条件路径</span><input v-model="step.conditionPath" aria-label="条件路径" placeholder="input.includeSummary"></label>
              <label class="field"><span>条件运算符</span><select v-model="step.conditionOperator" aria-label="条件运算符">
                <option value="truthy">为真</option>
                <option value="falsy">为假</option>
                <option value="equals">等于</option>
                <option value="not_equals">不等于</option>
                <option value="exists">存在</option>
                <option value="not_exists">不存在</option>
                <option value="contains">包含</option>
              </select></label>
              <label class="field" v-if="!['truthy', 'falsy', 'exists', 'not_exists'].includes(step.conditionOperator)"><span>条件值</span><input

                v-model="step.conditionValueText"
                aria-label="条件值"
                placeholder="true"
              ></label>
            </div>
            <label class="field" v-if="step.stepType === 'cli'"><span>命令模板</span><input

              v-model="step.commandTemplate"
              aria-label="命令模板"
              placeholder="git status"
            ></label>
            <label class="field" v-if="step.stepType === 'mcp_tool'"><span>工具名称</span><input

              v-model="step.toolName"
              aria-label="工具名称"
              placeholder="workspace.git_status"
            ></label>
            <label class="field"><span>输入模板</span><textarea
              v-model="step.inputTemplateText"
              aria-label="输入模板"
              rows="3"
              placeholder='{"previous":"{{steps.inspect.summary}}"}'
            ></textarea></label>
          </div>
        </div>
      </div>
      <div v-if="activeSection === 'automations' && showAutomationEditor" id="automation-registration" class="item stack wide editor-panel">
        <h2>新建自动化规则</h2>
        <p v-if="!workflows.length" class="inline-empty">先保存一个工作流，再为它配置自动运行规则。<button class="text-link" type="button" @click="selectSection('workflows')">前往工作流<ArrowRight :size="14" /></button></p>
        <label class="field"><span>关联工作流</span><select v-model.number="selectedWorkflowId" aria-label="关联工作流"><option :value="null">{{ workflows.length ? '默认工作流' : '暂无可用工作流' }}</option><option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">{{ workflow.name }}</option></select></label>
        <label class="field"><span>自动化名称</span><input v-model="automationName" aria-label="自动化名称"></label>
        <div class="automation-schedule-form">
          <label class="field"><span>自动化触发类型</span><select v-model="automationTriggerType" aria-label="自动化触发类型">
            <option value="schedule">定时触发</option>
            <option value="project_stale">项目停滞</option>
            <option value="task_due">任务到期</option>
          </select></label>
          <label class="field" v-if="automationTriggerType === 'schedule'"><span>调度类型</span><select v-model="automationScheduleType" aria-label="调度类型">
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select></label>
          <label class="field" v-if="automationTriggerType === 'schedule' && automationScheduleType === 'weekly'"><span>每周日期</span><select v-model="automationWeekday" aria-label="每周日期">
            <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">{{ day.label }}</option>
          </select></label>
          <label class="field" v-if="automationTriggerType === 'schedule' && automationScheduleType !== 'hourly'"><span>调度时间</span><input

            v-model="automationScheduleTime"
            aria-label="调度时间"
            type="time"
          ></label>
          <label class="field" v-if="automationTriggerType === 'project_stale'"><span>停滞项目</span><select v-model.number="automationProjectId" aria-label="停滞项目">
            <option :value="null">选择项目</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          </select></label>
          <label class="field" v-if="automationTriggerType === 'project_stale'"><span>停滞小时数</span><input

            v-model.number="automationStaleHours"
            aria-label="停滞小时数"
            type="number"
            min="1"
            max="8760"
          ></label>
          <label class="field" v-if="automationTriggerType === 'task_due'"><span>到期任务</span><select v-model.number="automationTaskId" aria-label="到期任务">
            <option :value="null">选择有截止时间的任务</option>
            <option v-for="todo in todos" :key="todo.id" :value="todo.id">{{ todo.title }}</option>
          </select></label>
          <label class="field"><span>时区</span><input v-model="automationTimezone" aria-label="时区"></label>
          <label class="field"><span>最大重试次数</span><input v-model.number="automationMaxRetries" aria-label="最大重试次数" type="number" min="0" max="5"></label>
          <label class="field"><span>重试延迟秒数</span><input v-model.number="automationRetryDelaySeconds" aria-label="重试延迟秒数" type="number" min="10" max="86400"></label>
          <label class="toggle-line">
            <input v-model="automationNotifyOnFailure" type="checkbox">
            失败通知
          </label>
        </div>
        <div class="row"><button type="button" :disabled="!workflows.length || !automationName.trim()" @click="performAction(() => createAutomationRule())">创建规则</button><button class="secondary" type="button" @click="showAutomationEditor = false">取消</button></div>
      </div>
    </section>

    <section v-if="['mcp', 'workflows', 'automations', 'runs'].includes(activeSection)" class="grid workbench-grid">
      <div v-if="activeSection === 'mcp'" class="item">
        <div class="section-title"><h2>已连接服务</h2><span class="count-text">{{ servers.length }} 个服务</span></div>
        <div v-if="!servers.length" class="empty-panel"><span class="empty-icon"><Plug :size="25" /></span><h3>接入第一个工具服务</h3><p>添加内置或外部 MCP 服务，让 Lyle 使用你需要的工具。</p><button v-if="!showServerEditor" class="secondary" type="button" @click="showServerEditor = true"><Plus :size="15" />添加服务</button></div>
        <div v-for="server in servers" :key="server.id" class="server-row">
          <span>
            {{ server.name }}
            <span class="badge">{{ server.serverType }}</span>
            <span class="badge" :class="{ success: server.lastHealthStatus === 'ok', danger: server.lastHealthStatus === 'error' }">
              {{ server.lastHealthStatus || server.status }}
            </span>
          </span>
          <span class="muted">{{ server.lastHealthMessage || '尚未检查连接' }}</span>
          <span class="row">
            <button class="secondary" type="button" @click="performAction(() => checkServer(server))">检查</button>
            <button v-if="server.serverType !== 'builtin'" class="secondary" type="button" @click="performAction(() => syncServer(server))">发现工具</button>
            <button class="secondary" type="button" @click="performAction(() => toggleServer(server))">
              {{ server.status === 'enabled' ? '停用' : '启用' }}
            </button>
          </span>
        </div>
      </div>
      <div v-if="activeSection === 'mcp'" class="item">
        <div class="section-title"><h2>可用工具</h2><span class="count-text">{{ tools.length }} 个工具</span></div>
        <div v-if="!tools.length" class="empty-panel"><span class="empty-icon"><Blocks :size="25" /></span><h3>工具会出现在这里</h3><p>{{ servers.length ? '在服务中点击“发现工具”，同步可用工具后即可配置权限。' : '连接服务后，在这里查看工具、配置权限和试运行。' }}</p><span class="empty-hint">{{ servers.length ? '从左侧服务开始' : '先添加一个服务' }}</span></div>
        <div
          v-for="tool in tools"
          :key="tool.id"
          class="tool-row"
          :class="{ suggested: Number(tool.id) === suggestedToolId }"
        >
          <span>
            {{ tool.toolName }}
            <span class="badge" :class="{ danger: tool.riskLevel === 'dangerous' }">{{ tool.riskLevel }}</span>
          </span>
          <span class="tool-policy-controls">
            <label class="field"><span>工具风险等级</span><select v-model="tool.riskLevel" aria-label="工具风险等级">
              <option v-for="risk in riskOptions" :key="risk" :value="risk">{{ risk }}</option>
            </select></label>
            <label class="toggle-line">
              <input v-model="tool.enabled" type="checkbox">
              启用
            </label>
            <button class="secondary" type="button" @click="performAction(() => saveToolPolicy(tool))">保存</button>
            <button class="secondary" type="button" @click="performAction(() => invokeTool(tool))">调用</button>
          </span>
          <details v-if="servers.find((server) => Number(server.id) === Number(tool.serverId))?.serverType !== 'builtin'" class="tool-arguments">
            <summary>参数与 Schema</summary>
            <label class="field"><span>MCP 工具参数</span><textarea
              v-model="mcpArguments[Number(tool.id)]"
              aria-label="MCP 工具参数"
              rows="3"
              placeholder="{}"
            ></textarea></label>
            <pre>{{ JSON.stringify(tool.inputSchema || {}, null, 2) }}</pre>
          </details>
        </div>
        <div v-if="mcpResult?.requiresConfirmation && pendingMcpTool" class="notice command-confirmation">
          <span>{{ mcpResult.requiresSecondConfirmation ? '该 MCP 操作需要二次确认。' : '该 MCP 操作需要确认。' }}</span>
          <button
            type="button"
            :class="{ 'danger-confirm': mcpResult.requiresSecondConfirmation }"
            @click="performAction(confirmMcpInvocation)"
          >
            {{ mcpResult.requiresSecondConfirmation ? '二次确认调用' : '确认调用' }}
          </button>
        </div>
        <pre v-if="mcpResult">{{ JSON.stringify(mcpResult, null, 2) }}</pre>
      </div>
      <div v-if="activeSection === 'workflows'" class="item wide">
        <div class="section-title"><h2>我的工作流</h2><span class="count-text">{{ workflows.length }} 个工作流</span></div>
        <div v-if="!workflows.length" class="empty-panel"><span class="empty-icon"><GitBranch :size="27" /></span><h3>把重复步骤交给工作流</h3><p>组合命令、工具和汇总步骤，保存后就能重复运行。</p><button v-if="!showWorkflowEditor" class="secondary" type="button" @click="resetWorkflowDraft"><Plus :size="15" />创建第一个工作流</button></div>
        <div v-for="workflow in workflows" :key="workflow.id" class="saved-workflow-row"><span class="saved-workflow-icon"><Workflow :size="20" /></span><div><strong>{{ workflow.name }}</strong><p>{{ workflow.description || '打开工作流，查看步骤与运行配置。' }}</p></div><button class="secondary" type="button" @click="selectedWorkflowId = Number(workflow.id); performAction(loadWorkflowEditor)">编辑工作流<ArrowRight :size="14" /></button></div>
      </div>
      <div v-if="activeSection === 'automations'" class="item wide">
        <div class="section-title"><h2>自动化规则</h2><span class="count-text">{{ automations.length }} 条规则</span></div>
        <div v-if="!automations.length" class="empty-panel"><span class="empty-icon"><Zap :size="26" /></span><h3>让工作流按时开始</h3><p>按时间、项目状态或任务到期触发，减少重复操作。</p><button v-if="!showAutomationEditor" class="secondary" type="button" @click="showAutomationEditor = true"><Plus :size="15" />新建规则</button><RouterLink class="text-link" to="/automations">也可以从自动化模板开始<ArrowRight :size="14" /></RouterLink></div>
        <div v-for="automation in automations" :key="automation.id" class="automation-row">
          <div class="section-title">
            <span>{{ automation.name }} <span class="badge">{{ automation.status }}</span></span>
            <span class="row">
              <button class="secondary" type="button" @click="performAction(() => runAutomationOnce(automation))">运行一次</button>
              <button
                v-if="automation.triggerType !== 'schedule'"
                class="secondary"
                type="button"
                @click="performAction(() => checkAutomationTrigger(automation))"
              >检查触发</button>
              <button class="secondary" type="button" @click="performAction(() => loadAutomationRuns(automation))">记录</button>
              <button class="secondary" type="button" @click="performAction(() => setAutomation(automation, automation.status !== 'enabled'))">
                {{ automation.status === 'enabled' ? '暂停' : '启用' }}
              </button>
              <button
                v-if="pendingAutomationDeleteId !== Number(automation.id)"
                class="secondary"
                type="button"
                @click="requestAutomationDelete(automation)"
              >删除</button>
              <button
                v-else
                class="danger-confirm"
                type="button"
                @click="performAction(() => confirmAutomationDelete(automation))"
              >确认删除</button>
            </span>
          </div>
          <details v-if="automationDrafts[Number(automation.id)]" class="config-details"><summary><Settings2 :size="15" />配置规则<ChevronDown :size="15" /></summary><div class="automation-config-grid">
            <label class="field"><span>自动化名称</span><input v-model="automationDrafts[Number(automation.id)].name" aria-label="自动化名称"></label>
            <label class="field"><span>自动化触发类型</span><select v-model="automationDrafts[Number(automation.id)].triggerType" aria-label="自动化触发类型">
              <option value="schedule">定时触发</option>
              <option value="project_stale">项目停滞</option>
              <option value="task_due">任务到期</option>
            </select></label>
            <label class="field" v-if="automationDrafts[Number(automation.id)].triggerType === 'schedule'"><span>调度类型</span><select

              v-model="automationDrafts[Number(automation.id)].scheduleType"
              aria-label="调度类型"
            >
              <option value="hourly">每小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select></label>
            <label class="field" v-if="automationDrafts[Number(automation.id)].triggerType === 'schedule' && automationDrafts[Number(automation.id)].scheduleType === 'weekly'"><span>每周日期</span><select

              v-model="automationDrafts[Number(automation.id)].weekday"
              aria-label="每周日期"
            >
              <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">{{ day.label }}</option>
            </select></label>
            <label class="field" v-if="automationDrafts[Number(automation.id)].triggerType === 'schedule' && automationDrafts[Number(automation.id)].scheduleType !== 'hourly'"><span>调度时间</span><input

              v-model="automationDrafts[Number(automation.id)].scheduleTime"
              aria-label="调度时间"
              type="time"
            ></label>
            <label class="field" v-if="automationDrafts[Number(automation.id)].triggerType === 'project_stale'"><span>停滞项目</span><select

              v-model.number="automationDrafts[Number(automation.id)].projectId"
              aria-label="停滞项目"
            >
              <option :value="null">选择项目</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select></label>
            <label class="field" v-if="automationDrafts[Number(automation.id)].triggerType === 'project_stale'"><span>停滞小时数</span><input

              v-model.number="automationDrafts[Number(automation.id)].staleHours"
              aria-label="停滞小时数"
              type="number"
              min="1"
              max="8760"
            ></label>
            <label class="field" v-if="automationDrafts[Number(automation.id)].triggerType === 'task_due'"><span>到期任务</span><select

              v-model.number="automationDrafts[Number(automation.id)].taskId"
              aria-label="到期任务"
            >
              <option :value="null">选择有截止时间的任务</option>
              <option v-for="todo in todos" :key="todo.id" :value="todo.id">{{ todo.title }}</option>
            </select></label>
            <label class="field"><span>时区</span><input v-model="automationDrafts[Number(automation.id)].timezone" aria-label="时区"></label>
            <label class="field"><span>最大重试次数</span><input
              v-model.number="automationDrafts[Number(automation.id)].maxRetries"
              aria-label="最大重试次数"
              type="number"
              min="0"
              max="5"
            ></label>
            <label class="field"><span>重试延迟秒数</span><input
              v-model.number="automationDrafts[Number(automation.id)].retryDelaySeconds"
              aria-label="重试延迟秒数"
              type="number"
              min="10"
              max="86400"
            ></label>
            <label class="toggle-line">
              <input v-model="automationDrafts[Number(automation.id)].notifyOnFailure" type="checkbox">
              失败通知
            </label>
            <label class="field"><span>自动化状态</span><select v-model="automationDrafts[Number(automation.id)].status" aria-label="自动化状态">
              <option value="paused">暂停</option>
              <option value="enabled">启用</option>
            </select></label>
            <button class="secondary" type="button" @click="performAction(() => saveAutomationConfig(automation))">保存配置</button>
          </div>
          </details>
          <div class="detail-meta">
            <span>连续失败：{{ automation.consecutiveFailures || 0 }}</span>
            <span>触发：{{ automation.triggerType }}{{ automation.scheduleExpr ? ` / ${automation.scheduleExpr}` : '' }}</span>
            <span>时区：{{ automation.timezone }}</span>
            <span>下次：{{ automation.nextRunAt || '-' }}</span>
            <span>上次：{{ automation.lastRunAt || '-' }}</span>
          </div>
        </div>
        <pre v-if="automationResult">{{ JSON.stringify(automationResult, null, 2) }}</pre>
      </div>
      <div v-if="activeSection === 'runs'" class="item wide">
        <div class="section-title"><h2>运行记录</h2><span class="count-text">最近 {{ workflowRuns.length + automationRuns.length }} 次运行</span></div>
        <div class="run-history">
          <div>
            <h3>工作流运行</h3>
            <div v-if="!workflowRuns.length" class="empty-panel compact-empty"><span class="empty-icon"><History :size="25" /></span><h3>还没有运行记录</h3><p>工作流运行后，步骤进度、结果和异常会显示在这里。</p><button class="text-link" type="button" @click="selectSection('workflows')">查看工作流<ArrowRight :size="14" /></button></div>
            <div v-for="run in workflowRuns" :key="run.id" class="workflow-run-card">
              <div class="run-row">
                <span>#{{ run.id }} / workflow {{ run.workflowId }}</span>
                <span
                  class="badge"
                  :class="{ success: run.status === 'completed', danger: run.status === 'failed', pending: run.status === 'paused' }"
                >
                  {{ run.status }}
                </span>
                <span class="muted">{{ run.triggerType }}</span>
                <span class="run-summary">
                  {{ run.steps?.map((step: Item) => `${step.title}:${step.status}`).join(' / ') }}
                </span>
                <span class="workflow-run-actions">
                  <button class="secondary" type="button" @click="performAction(() => toggleWorkflowRun(run))">
                    {{ expandedWorkflowRunId === Number(run.id) ? '收起' : '详情' }}
                  </button>
                  <button v-if="run.status === 'paused'" type="button" @click="performAction(() => resumeWorkflowRun(run))">确认继续</button>
                  <button
                    v-if="run.status === 'paused' && workflowNeedsSecondConfirmation(run)"
                    class="danger-confirm"
                    type="button"
                    @click="performAction(() => resumeWorkflowRun(run, true))"
                  >二次确认继续</button>
                  <button v-if="run.status === 'failed'" class="secondary" type="button" @click="performAction(() => retryWorkflowRun(run))">重试</button>
                  <button v-if="run.status === 'paused' || run.status === 'running'" class="secondary" type="button" @click="performAction(() => cancelWorkflowRun(run))">取消</button>
                </span>
              </div>
              <div v-if="expandedWorkflowRunId === Number(run.id)" class="workflow-run-detail">
                <div class="detail-meta">
                  <span>开始：{{ workflowRunDetails[Number(run.id)]?.startedAt || run.startedAt || '-' }}</span>
                  <span>完成：{{ workflowRunDetails[Number(run.id)]?.completedAt || run.completedAt || '-' }}</span>
                  <span v-if="workflowRunDetails[Number(run.id)]?.errorMessage || run.errorMessage">
                    错误：{{ workflowRunDetails[Number(run.id)]?.errorMessage || run.errorMessage }}
                  </span>
                </div>
                <div
                  v-for="step in (workflowRunDetails[Number(run.id)]?.steps || run.steps || [])"
                  :key="step.id"
                  class="workflow-step-detail"
                >
                  <div class="section-title">
                    <span>
                      {{ step.sortOrder }}. {{ step.title }}
                      <span
                        class="badge"
                        :class="{ success: step.status === 'completed', danger: step.status === 'failed', pending: step.status === 'awaiting_confirmation' }"
                      >
                        {{ step.status }}
                      </span>
                    </span>
                    <span class="muted">{{ step.stepType }}<span v-if="step.cliRunId"> / cli #{{ step.cliRunId }}</span></span>
                  </div>
                  <p v-if="step.errorMessage" class="alert danger">{{ step.errorMessage }}</p>
                  <pre v-if="step.input && Object.keys(step.input).length">input {{ JSON.stringify(step.input, null, 2) }}</pre>
                  <pre v-if="step.output && Object.keys(step.output).length">output {{ JSON.stringify(step.output, null, 2) }}</pre>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h3>自动化运行</h3>
            <p v-if="!automationRuns.length" class="inline-empty">暂无自动化运行记录。可在自动化规则中选择“记录”，查看对应规则的运行历史。</p>
            <div v-for="run in automationRuns" :key="run.id" class="run-row automation-run-row">
              <span>#{{ run.id }} / workflow {{ run.workflowRunId }}</span>
              <span class="badge" :class="{ success: run.status === 'completed', danger: run.status === 'failed' }">{{ run.status }}</span>
              <span class="muted">{{ run.createdAt }}</span>
              <span>{{ run.errorMessage }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="activeSection === 'runs'" class="item wide">
        <div class="section-title"><h2>执行审计</h2><span class="count-text">最近 {{ audit.length }} 条记录</span></div>
        <p v-if="!audit.length" class="inline-empty">还没有执行事件。工具或命令运行后，可在这里追溯执行方式与结果。</p>
        <div v-for="entry in audit" :key="entry.id" class="audit-row">
          <span>{{ entry.executorType }} / {{ entry.executorName }}</span>
          <span class="badge">{{ entry.riskLevel }}</span>
          <span class="muted">{{ entry.status }}</span>
          <span>{{ entry.outputSummary }}</span>
        </div>
      </div>
    </section>
    </fieldset>
    <p class="workbench-footnote"><Settings2 :size="14" />修改权限与执行规则后，将应用到后续运行。</p>
  </div>
</template>

<style scoped>
.workbench-page { width: 100%; max-width: 1180px; min-width: 0; margin: 0 auto; gap: 24px; }
.workbench-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.workbench-header h1 { margin: 0; font-size: 32px; line-height: 1.35; letter-spacing: -.7px; font-weight: 650; }
.workbench-header p { margin: 9px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.workbench-page button, .workbench-page .button-link { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; border-radius: 8px; padding: 8px 13px; font-size: 13px; line-height: 1.45; font-weight: 600; box-shadow: none; }
.workbench-page button.secondary { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }
.workbench-page button.secondary:hover { border-color: var(--primary-border); background: var(--primary-soft); color: var(--primary); }
.workbench-page button:disabled { cursor: not-allowed; opacity: .55; }
.workbench-page button:focus-visible, .workbench-page a:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.workbench-page .refresh-action { background: transparent; border-color: transparent; color: var(--muted-foreground); }
.workbench-page .notice { margin: 0; border: 1px solid var(--primary-border); border-radius: 10px; background: var(--primary-soft); padding: 12px 16px; color: var(--foreground); font-size: 13px; line-height: 1.7; }
.workbench-tabs { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 5px; border: 1px solid var(--border); border-radius: 13px; padding: 6px; background: var(--surface); overflow: visible; }
.workbench-tabs button { min-width: 0; min-height: 48px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--muted-foreground); padding: 10px 8px; font-size: 13px; white-space: nowrap; }
.workbench-tabs button.active { border-color: transparent; background: var(--primary-soft); color: var(--primary); }
.workbench-tabs button:hover { background: var(--surface-muted); color: var(--primary); }
.workbench-tabs button.active:hover { background: var(--primary-soft); }
.workbench-tabs svg { flex-shrink: 0; }
.workbench-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.workbench-page .workbench-section-heading h2 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.4; }
.workbench-section-heading p { margin: 7px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.7; }
.workbench-section-heading > button, .workbench-section-heading > a { flex-shrink: 0; }
.workbench-content { display: grid; gap: 20px; min-width: 0; width: 100%; margin: 0; padding: 0; border: 0; }
.workbench-content:disabled { opacity: .75; }
.workbench-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; min-width: 0; gap: 20px; }
.workbench-page .item { min-width: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 23px; box-shadow: none; }
.workbench-page .wide { grid-column: 1 / -1; }
.workbench-page .stack { gap: 17px; }
.workbench-page h2 { margin: 0; font-size: 16px; line-height: 1.5; font-weight: 650; }
.workbench-page h3 { margin: 0; font-size: 14px; line-height: 1.6; }
.workbench-page .section-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 17px; }
.workbench-page .stack > .section-title { margin-bottom: 0; }
.workbench-page .section-title > span:first-child { overflow-wrap: anywhere; font-size: 14px; font-weight: 600; }
.workbench-page .count-text, .workbench-page .muted { color: var(--muted-foreground); font-size: 12px; font-weight: 400; line-height: 1.6; }
.workbench-page .empty-panel { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; padding: 34px 15px 28px; text-align: center; }
.empty-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 15px; background: var(--primary-soft); color: var(--primary); margin-bottom: 18px; }
.empty-panel h3 { color: var(--foreground); font-size: 16px; line-height: 1.65; font-weight: 600; }
.empty-panel p { max-width: 350px; margin: 9px 0 22px; color: var(--muted-foreground); font-size: 13px; line-height: 1.8; }
.empty-panel .empty-hint { display: grid; min-height: 38px; align-items: center; font-size: 12px; color: var(--muted-foreground); }
.empty-panel > .text-link { margin-top: 12px; }
.workbench-page .compact-empty { padding: 30px 14px; }
.workbench-page .inline-empty { margin: 0; border-radius: 9px; background: var(--surface-muted); padding: 16px; color: var(--muted-foreground); font-size: 13px; line-height: 1.8; }
.workbench-page .inline-empty > .text-link { margin-left: 8px; }
.workbench-page .text-link { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; border: 0; padding: 2px 0; background: transparent; color: var(--primary); text-decoration: none; font-size: 13px; font-weight: 550; }
.workbench-page .text-link:hover { text-decoration: underline; text-underline-offset: 4px; }
.workbench-page .field { display: grid; align-content: start; gap: 7px; min-width: 0; color: var(--foreground); font-size: 12px; font-weight: 550; line-height: 1.6; }
.workbench-page .field input, .workbench-page .field select, .workbench-page .field textarea { min-width: 0; width: 100%; max-width: 100%; min-height: 40px; border-radius: 8px; padding: 9px 11px; box-sizing: border-box; background: var(--surface); font-size: 13px; font-weight: 400; line-height: 1.5; }
.workbench-page .field textarea { resize: vertical; }
.workbench-page input:focus, .workbench-page select:focus, .workbench-page textarea:focus { border-color: var(--primary); }
.workbench-page .row { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
.workbench-page .row > .field { flex: 1 1 180px; }
.workbench-page .row > button { flex: 0 0 auto; min-height: 40px; }
.workbench-page .editor-panel { border-color: var(--primary-border); background: var(--surface); }
.workbench-page .editor-panel > .field { max-width: 740px; }
.workbench-page .editor-panel .row { max-width: 100%; }
.workbench-page .workspace-registration-form input:first-child { max-width: 100%; }
.config-details { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.config-details > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; padding: 13px 15px; color: var(--foreground); font-size: 13px; font-weight: 550; }
.config-details > summary::-webkit-details-marker { display: none; }
.config-details > summary > span { color: var(--muted-foreground); font-size: 12px; font-weight: 400; }
.config-details > summary > svg:last-child { margin-left: auto; color: var(--muted-foreground); }
.config-details[open] > summary > svg:last-child { transform: rotate(180deg); }
.config-details > div, .config-details > p { margin: 0 15px 15px; }
.workbench-page .command-policy-editor { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto; gap: 10px; }
.workbench-page .workflow-editor { gap: 17px; margin-top: 0; }
.workbench-page .workflow-step-editor { gap: 14px; padding: 18px; border-radius: 11px; border-color: var(--border); background: var(--surface-muted); }
.workbench-page .workflow-step-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: end; gap: 12px; }
.workbench-page .toggle-line { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; font-size: 13px; }
.workbench-page .toggle-line input { width: 15px; height: 15px; accent-color: var(--primary); }
.workbench-page .automation-schedule-form, .workbench-page .automation-config-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: end; gap: 14px; }
.workbench-page .automation-row { gap: 15px; padding: 21px 0; border-color: var(--border); }
.workbench-page .automation-row:last-of-type { padding-bottom: 0; }
.workbench-page .automation-row .section-title { margin: 0; }
.workbench-page .automation-row .row { gap: 7px; }
.workbench-page .automation-row button { min-height: 34px; font-size: 12px; padding: 7px 10px; }
.workbench-page .server-row { gap: 11px; padding: 18px 0; border-color: var(--border); }
.workbench-page .server-row > span:first-child { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.workbench-page .server-row:first-of-type { padding-top: 5px; }
.workbench-page .tool-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 13px; padding: 18px 0; border-color: var(--border); }
.workbench-page .tool-row > span:first-child { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; font-weight: 550; overflow-wrap: anywhere; }
.workbench-page .tool-policy-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.workbench-page .tool-policy-controls > .field { flex: 1 1 140px; }
.workbench-page .tool-row.suggested { border: 1px solid var(--primary-border); border-radius: 10px; padding: 15px; background: var(--primary-soft); box-shadow: none; }
.workbench-page .tool-arguments summary { font-size: 12px; line-height: 1.8; }
.workbench-page .tool-arguments .field { margin-top: 12px; }
.workbench-page .badge { display: inline-flex; align-items: center; border-radius: 6px; padding: 3px 7px; background: var(--surface-muted); color: var(--muted-foreground); font-size: 11px; font-weight: 550; line-height: 1.5; overflow-wrap: anywhere; }
.workbench-page .badge.success { background: var(--success-soft); color: var(--success-strong); }
.workbench-page .badge.danger { background: var(--danger-soft); color: var(--danger-strong); }
.workbench-page .badge.pending { background: var(--warning-soft); color: var(--warning-strong); }
.saved-workflow-row { display: flex; align-items: center; gap: 14px; padding: 19px 0; border-top: 1px solid var(--border); }
.saved-workflow-icon { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 11px; background: var(--primary-soft); color: var(--primary); }
.saved-workflow-row > div { min-width: 0; flex: 1; }
.saved-workflow-row strong { font-size: 14px; overflow-wrap: anywhere; }
.saved-workflow-row p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.saved-workflow-row button { flex: 0 0 auto; }
.workbench-page .run-history { gap: 22px; }
.workbench-page .run-history > div > h3 { margin-bottom: 15px; color: var(--muted-foreground); font-size: 13px; font-weight: 550; }
.workbench-page .run-row { grid-template-columns: minmax(100px, 1fr) auto auto; gap: 12px; font-size: 13px; }
.workbench-page .run-summary { grid-column: 1 / -1; color: var(--muted-foreground); font-size: 12px; line-height: 1.8; }
.workbench-page .workflow-run-actions { grid-column: 1 / -1; justify-content: flex-start; }
.workbench-page .automation-run-row { grid-template-columns: minmax(100px, 1fr) auto minmax(100px, 1fr); }
.workbench-page .automation-run-row > span:last-child { grid-column: 1 / -1; color: var(--danger-strong); }
.workbench-page .command-row, .workbench-page .audit-row { min-width: 0; gap: 12px; grid-template-columns: minmax(0, 1.5fr) auto minmax(0, 1fr) minmax(0, 1fr); padding: 14px 0; font-size: 12px; line-height: 1.7; }
.workbench-page .command-row > *, .workbench-page .audit-row > * { min-width: 0; overflow-wrap: anywhere; }
.workbench-page .detail-meta { color: var(--muted-foreground); font-size: 12px; line-height: 1.7; }
.workbench-page pre { max-height: 320px; max-width: 100%; margin: 0; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-muted); padding: 14px; color: var(--foreground); font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; }
.workbench-page .command-confirmation { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.workbench-footnote { display: flex; align-items: center; justify-content: center; gap: 7px; margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.8; }
.workbench-loading, .workbench-error { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 255px; gap: 13px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 25px; color: var(--muted-foreground); text-align: center; font-size: 13px; }
.workbench-loading svg { color: var(--primary); }
.workbench-error > svg { color: var(--danger-strong); }.workbench-error h3 { color: var(--foreground); font-size: 17px; }.workbench-error p { margin: 0; max-width: 480px; line-height: 1.8; }
.spinning { animation: workbench-spin 1s linear infinite; } @keyframes workbench-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
@media (max-width: 1100px) { .workbench-tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); } .workbench-page .automation-config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  .workbench-page { gap: 19px; }.workbench-header h1 { font-size: 27px; }.workbench-header p { font-size: 13px; }.workbench-header { align-items: flex-start; gap: 12px; }.workbench-header .refresh-action { padding: 8px; flex-shrink: 0; }
  .workbench-grid { grid-template-columns: minmax(0, 1fr); gap: 17px; }.workbench-section-heading { align-items: flex-start; gap: 14px; }.workbench-page .workbench-section-heading h2 { font-size: 18px; }.workbench-section-heading p { max-width: 390px; font-size: 12px; }
  .workbench-page .item { padding: 19px; }.workbench-page .empty-panel { padding: 25px 8px; }.workbench-page .empty-panel p { max-width: 310px; }
  .workbench-page .command-policy-editor, .workbench-page .workflow-step-grid, .workbench-page .automation-schedule-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }.workbench-page .command-row, .workbench-page .audit-row { grid-template-columns: minmax(0, 1fr) auto; }.workbench-page .run-row { grid-template-columns: minmax(0, 1fr) auto; }.workbench-page .run-row > .muted { grid-column: 1 / -1; }
}
@media (max-width: 480px) {
  .workbench-tabs { gap: 4px; padding: 5px; border-radius: 11px; }.workbench-tabs button { flex-direction: column; gap: 7px; min-height: 66px; padding: 8px 3px; font-size: 11px; }
  .workbench-header p { max-width: 240px; }.workbench-section-heading { flex-wrap: wrap; }.workbench-section-heading > div { flex: 1 1 180px; }.workbench-section-heading > button { min-height: 35px; padding: 7px 10px; font-size: 12px; }.workbench-section-heading p { max-width: 230px; }
  .workbench-page .item { padding: 17px 15px; }.workbench-page .row { flex-direction: row; }.workbench-page .row > .field { flex: 1 1 100%; }.workbench-page .row > button { flex: 0 1 auto; width: auto; }
  .workbench-page .command-policy-editor, .workbench-page .workflow-step-grid, .workbench-page .automation-schedule-form, .workbench-page .automation-config-grid { grid-template-columns: minmax(0, 1fr); }.workbench-page .workflow-step-editor { padding: 13px; }
  .saved-workflow-row { flex-wrap: wrap; gap: 10px; }.saved-workflow-row > div { flex-basis: calc(100% - 55px); }.saved-workflow-row button { margin-left: 52px; }.workbench-page .field { font-size: 12px; }.workbench-footnote { align-items: flex-start; font-size: 11px; }.workbench-footnote svg { flex-shrink: 0; margin-top: 3px; }
}
</style>
