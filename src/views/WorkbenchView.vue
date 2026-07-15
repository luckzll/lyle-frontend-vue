<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
const workbenchSections: Array<{ id: WorkbenchSection; label: string }> = [
  { id: 'connectors', label: '数据连接' },
  { id: 'mcp', label: 'MCP 工具' },
  { id: 'cli', label: 'CLI 工作区' },
  { id: 'workflows', label: '工作流' },
  { id: 'automations', label: '自动化' },
  { id: 'runs', label: '执行记录' }
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
const message = ref('')
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
const serverUrl = ref('http://127.0.0.1:3000/mcp')
const serverHeadersText = ref('{}')
const serverCommand = ref('npx')
const serverArgsText = ref('-y\n@modelcontextprotocol/server-filesystem\n/Users/luckzll/Desktop/Lyle')
const serverCwd = ref('/Users/luckzll/Desktop/Lyle')
const serverEnvText = ref('{}')
const workspaceName = ref('Lyle')
const workspacePath = ref('/Users/luckzll/Desktop/Lyle')
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
  message.value = ''
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
    message.value = error?.response?.data?.message || error?.response?.data?.detail || '高级设置数据加载失败'
  } finally {
    loading.value = false
  }
}

async function addServer() {
  let configRef: Item | undefined
  if (serverType.value === 'streamable_http') {
    configRef = { url: serverUrl.value, headers: parseStrictJsonObject(serverHeadersText.value, 'HTTP Headers') }
  } else if (serverType.value === 'stdio') {
    configRef = {
      command: serverCommand.value,
      args: serverArgsText.value.split('\n').map((item) => item.trim()).filter(Boolean),
      cwd: serverCwd.value || undefined,
      env: parseStrictJsonObject(serverEnvText.value, '环境变量')
    }
  }
  const created = await createMcpServer({
    name: serverName.value,
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
}

async function addWorkspace() {
  await createWorkspace({ name: workspaceName.value, rootPath: workspacePath.value, status: 'active' })
  message.value = '工作区已注册'
  await refreshAll()
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
    <div class="toolbar">
      <div>
        <p class="eyebrow">高级模式</p>
        <h1>高级设置</h1>
        <p class="muted">数据连接、工具权限、工作流与可控执行。修改策略可能影响自动化范围与写操作权限。</p>
      </div>
      <button class="secondary" type="button" :disabled="loading" @click="refreshAll">刷新</button>
    </div>

    <div v-if="message" class="notice">{{ message }}</div>
    <div class="alert pending" role="note">
      这里面向熟悉执行策略的高级用户。保存前请核对数据范围、权限和确认规则；日常运行与结果处理请优先使用自动化和执行中心。
    </div>

    <nav class="workbench-tabs" aria-label="工具分区">
      <button
        v-for="section in workbenchSections"
        :key="section.id"
        type="button"
        :class="{ active: activeSection === section.id }"
        :aria-pressed="activeSection === section.id"
        :data-testid="`workbench-tab-${section.id}`"
        @click="selectSection(section.id)"
      >{{ section.label }}</button>
    </nav>

    <ConnectorView v-if="activeSection === 'connectors'" embedded />

    <section v-if="['mcp', 'cli', 'workflows', 'automations'].includes(activeSection)" class="grid workbench-grid">
      <div v-if="activeSection === 'mcp'" class="item stack">
        <div class="section-title">
          <h2>注册 MCP Server</h2>
          <span class="badge">{{ servers.length }}</span>
        </div>
        <input v-model="serverName" aria-label="MCP Server 名称">
        <select v-model="serverType" aria-label="MCP 连接类型">
          <option value="builtin">内置</option>
          <option value="streamable_http">Streamable HTTP</option>
          <option value="stdio">stdio</option>
        </select>
        <template v-if="serverType === 'streamable_http'">
          <input v-model="serverUrl" aria-label="MCP Server URL" placeholder="http://127.0.0.1:3000/mcp">
          <textarea v-model="serverHeadersText" aria-label="MCP HTTP Headers" rows="3" placeholder='{"Authorization":"Bearer ..."}'></textarea>
        </template>
        <template v-if="serverType === 'stdio'">
          <input v-model="serverCommand" aria-label="MCP 启动命令" placeholder="npx">
          <textarea v-model="serverArgsText" aria-label="MCP 启动参数" rows="4" placeholder="每行一个参数"></textarea>
          <input v-model="serverCwd" aria-label="MCP 工作目录" placeholder="工作目录">
          <textarea v-model="serverEnvText" aria-label="MCP 环境变量" rows="3" placeholder='{"GITHUB_TOKEN":"..."}'></textarea>
        </template>
        <button type="button" @click="addServer">注册</button>
      </div>
      <div v-if="activeSection === 'cli'" class="item wide stack">
        <div class="section-title">
          <h2>注册工作区</h2>
          <span class="badge">{{ workspaces.length }}</span>
        </div>
        <div class="row workspace-registration-form">
          <input v-model="workspaceName" aria-label="工作区名称">
          <input v-model="workspacePath" aria-label="工作区路径">
          <button type="button" @click="addWorkspace">注册</button>
        </div>
      </div>
      <div v-if="activeSection === 'cli'" class="item wide">
        <h2>CLI 命令</h2>
        <div class="row">
          <select v-model.number="selectedWorkspaceId" class="inline-input" aria-label="选择工作区" @change="loadWorkspaceDetails">
            <option :value="null">默认工作区</option>
            <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
              {{ workspace.name }}
            </option>
          </select>
          <input v-model="command" aria-label="命令">
          <button class="secondary" type="button" @click="previewCommand">预览</button>
          <button type="button" @click="executeCommand(false)">执行</button>
          <button class="secondary" type="button" @click="loadCommandRuns">记录</button>
        </div>
        <div class="row command-policy-editor">
          <input v-model="commandPolicyPattern" aria-label="命令规则" placeholder="例如 git status*">
          <select v-model="commandPolicyType" aria-label="命令策略">
            <option value="allow">允许</option>
            <option value="confirm">需确认</option>
            <option value="deny">禁止</option>
          </select>
          <select v-model="commandPolicyRisk" aria-label="策略风险等级">
            <option v-for="risk in riskOptions" :key="risk" :value="risk">{{ risk }}</option>
          </select>
          <button class="secondary" type="button" @click="addCommandPolicy">添加规则</button>
        </div>
        <div v-if="commandPolicies.length" class="command-history">
          <div v-for="policy in commandPolicies" :key="policy.id" class="command-row">
            <span>{{ policy.commandPattern }}</span>
            <span class="badge" :class="{ danger: policy.policy === 'deny' }">{{ policy.policy }}</span>
            <span class="muted">{{ policy.riskLevel }}</span>
            <button class="secondary" type="button" aria-label="删除命令策略" @click="removeCommandPolicy(policy)">删除</button>
          </div>
        </div>
        <div v-if="commandResult?.requiresConfirmation" class="notice command-confirmation">
          <span>
            {{ commandResult.requiresSecondConfirmation ? '该命令需要二次确认。' : '该命令需要确认后执行。' }}
          </span>
          <button
            v-if="commandResult.requiresSecondConfirmation"
            class="danger-confirm"
            type="button"
            @click="executeCommandWithSecondConfirmation"
          >
            二次确认执行
          </button>
          <button v-else type="button" @click="executeCommand(true)">确认执行</button>
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
      </div>
      <div v-if="activeSection === 'workflows'" class="item wide">
        <h2>工作流编辑器</h2>
        <div class="row">
          <select v-model.number="selectedPlanId" aria-label="来源计划">
            <option :value="null">选择 V3 计划</option>
            <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.title }}</option>
          </select>
          <button class="secondary" type="button" @click="createWorkflowFromPlan">保存为工作流</button>
        </div>
        <select v-model.number="selectedWorkflowId" aria-label="选择工作流">
          <option :value="null">默认工作流</option>
          <option v-for="workflow in workflows" :key="workflow.id" :value="workflow.id">
            {{ workflow.name }}
          </option>
        </select>
        <div class="row">
          <button type="button" @click="createDailyWorkflow">创建巡检</button>
          <button class="secondary" type="button" @click="loadWorkflowEditor">载入编辑</button>
          <button class="secondary" type="button" @click="resetWorkflowDraft">新建草稿</button>
          <button type="button" @click="saveWorkflowDraft">保存工作流</button>
          <button class="secondary" type="button" @click="runSelectedWorkflow">运行</button>
        </div>
        <textarea v-model="workflowRunInputText" aria-label="工作流运行输入" rows="2"></textarea>
        <div class="workflow-editor">
          <input v-model="workflowDraft.name" aria-label="工作流名称">
          <textarea v-model="workflowDraft.description" aria-label="工作流描述" rows="2"></textarea>
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
              <input v-model="step.title" aria-label="步骤标题">
              <input v-model="step.outputKey" aria-label="步骤输出键" :placeholder="`step_${index + 1}`">
              <select v-model="step.stepType" aria-label="步骤类型">
                <option value="cli">CLI</option>
                <option value="mcp_tool">MCP</option>
                <option value="summarize">汇总</option>
              </select>
              <label class="toggle-line">
                <input v-model="step.requiresConfirmation" type="checkbox">
                需确认
              </label>
            </div>
            <div class="workflow-step-grid">
              <input v-model="step.conditionPath" aria-label="条件路径" placeholder="input.includeSummary">
              <select v-model="step.conditionOperator" aria-label="条件运算符">
                <option value="truthy">为真</option>
                <option value="falsy">为假</option>
                <option value="equals">等于</option>
                <option value="not_equals">不等于</option>
                <option value="exists">存在</option>
                <option value="not_exists">不存在</option>
                <option value="contains">包含</option>
              </select>
              <input
                v-if="!['truthy', 'falsy', 'exists', 'not_exists'].includes(step.conditionOperator)"
                v-model="step.conditionValueText"
                aria-label="条件值"
                placeholder="true"
              >
            </div>
            <input
              v-if="step.stepType === 'cli'"
              v-model="step.commandTemplate"
              aria-label="命令模板"
              placeholder="git status"
            >
            <input
              v-if="step.stepType === 'mcp_tool'"
              v-model="step.toolName"
              aria-label="工具名称"
              placeholder="workspace.git_status"
            >
            <textarea
              v-model="step.inputTemplateText"
              aria-label="输入模板"
              rows="3"
              placeholder='{"previous":"{{steps.inspect.summary}}"}'
            ></textarea>
          </div>
        </div>
      </div>
      <div v-if="activeSection === 'automations'" class="item stack">
        <h2>创建自动化</h2>
        <input v-model="automationName" aria-label="自动化名称">
        <div class="automation-schedule-form">
          <select v-model="automationTriggerType" aria-label="自动化触发类型">
            <option value="schedule">定时触发</option>
            <option value="project_stale">项目停滞</option>
            <option value="task_due">任务到期</option>
          </select>
          <select v-if="automationTriggerType === 'schedule'" v-model="automationScheduleType" aria-label="调度类型">
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
          <select v-if="automationTriggerType === 'schedule' && automationScheduleType === 'weekly'" v-model="automationWeekday" aria-label="每周日期">
            <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">{{ day.label }}</option>
          </select>
          <input
            v-if="automationTriggerType === 'schedule' && automationScheduleType !== 'hourly'"
            v-model="automationScheduleTime"
            aria-label="调度时间"
            type="time"
          >
          <select v-if="automationTriggerType === 'project_stale'" v-model.number="automationProjectId" aria-label="停滞项目">
            <option :value="null">选择项目</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          </select>
          <input
            v-if="automationTriggerType === 'project_stale'"
            v-model.number="automationStaleHours"
            aria-label="停滞小时数"
            type="number"
            min="1"
            max="8760"
          >
          <select v-if="automationTriggerType === 'task_due'" v-model.number="automationTaskId" aria-label="到期任务">
            <option :value="null">选择有截止时间的任务</option>
            <option v-for="todo in todos" :key="todo.id" :value="todo.id">{{ todo.title }}</option>
          </select>
          <input v-model="automationTimezone" aria-label="时区">
          <input v-model.number="automationMaxRetries" aria-label="最大重试次数" type="number" min="0" max="5">
          <input v-model.number="automationRetryDelaySeconds" aria-label="重试延迟秒数" type="number" min="10" max="86400">
          <label class="toggle-line">
            <input v-model="automationNotifyOnFailure" type="checkbox">
            失败通知
          </label>
        </div>
        <button type="button" @click="createAutomationRule">创建规则</button>
      </div>
    </section>

    <section v-if="['mcp', 'workflows', 'automations', 'runs'].includes(activeSection)" class="grid workbench-grid">
      <div v-if="activeSection === 'mcp'" class="item">
        <h2>MCP Servers</h2>
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
            <button class="secondary" type="button" @click="checkServer(server)">检查</button>
            <button v-if="server.serverType !== 'builtin'" class="secondary" type="button" @click="syncServer(server)">发现工具</button>
            <button class="secondary" type="button" @click="toggleServer(server)">
              {{ server.status === 'enabled' ? '停用' : '启用' }}
            </button>
          </span>
        </div>
      </div>
      <div v-if="activeSection === 'mcp'" class="item">
        <h2>MCP Tools</h2>
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
            <select v-model="tool.riskLevel" aria-label="工具风险等级">
              <option v-for="risk in riskOptions" :key="risk" :value="risk">{{ risk }}</option>
            </select>
            <label class="toggle-line">
              <input v-model="tool.enabled" type="checkbox">
              启用
            </label>
            <button class="secondary" type="button" @click="saveToolPolicy(tool)">保存</button>
            <button class="secondary" type="button" @click="invokeTool(tool)">调用</button>
          </span>
          <details v-if="servers.find((server) => Number(server.id) === Number(tool.serverId))?.serverType !== 'builtin'" class="tool-arguments">
            <summary>参数与 Schema</summary>
            <textarea
              v-model="mcpArguments[Number(tool.id)]"
              aria-label="MCP 工具参数"
              rows="3"
              placeholder="{}"
            ></textarea>
            <pre>{{ JSON.stringify(tool.inputSchema || {}, null, 2) }}</pre>
          </details>
        </div>
        <div v-if="mcpResult?.requiresConfirmation && pendingMcpTool" class="notice command-confirmation">
          <span>{{ mcpResult.requiresSecondConfirmation ? '该 MCP 操作需要二次确认。' : '该 MCP 操作需要确认。' }}</span>
          <button
            type="button"
            :class="{ 'danger-confirm': mcpResult.requiresSecondConfirmation }"
            @click="invokeTool(pendingMcpTool, true, Boolean(mcpResult.requiresSecondConfirmation))"
          >
            {{ mcpResult.requiresSecondConfirmation ? '二次确认调用' : '确认调用' }}
          </button>
        </div>
        <pre v-if="mcpResult">{{ JSON.stringify(mcpResult, null, 2) }}</pre>
      </div>
      <div v-if="activeSection === 'workflows'" class="item">
        <h2>已保存工作流</h2>
        <p v-for="workflow in workflows" :key="workflow.id">{{ workflow.name }}</p>
      </div>
      <div v-if="activeSection === 'automations'" class="item wide">
        <h2>自动化规则</h2>
        <div v-for="automation in automations" :key="automation.id" class="automation-row">
          <div class="section-title">
            <span>{{ automation.name }} <span class="badge">{{ automation.status }}</span></span>
            <span class="row">
              <button class="secondary" type="button" @click="runAutomationOnce(automation)">运行一次</button>
              <button
                v-if="automation.triggerType !== 'schedule'"
                class="secondary"
                type="button"
                @click="checkAutomationTrigger(automation)"
              >检查触发</button>
              <button class="secondary" type="button" @click="loadAutomationRuns(automation)">记录</button>
              <button class="secondary" type="button" @click="setAutomation(automation, automation.status !== 'enabled')">
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
                @click="confirmAutomationDelete(automation)"
              >确认删除</button>
            </span>
          </div>
          <div v-if="automationDrafts[Number(automation.id)]" class="automation-config-grid">
            <input v-model="automationDrafts[Number(automation.id)].name" aria-label="自动化名称">
            <select v-model="automationDrafts[Number(automation.id)].triggerType" aria-label="自动化触发类型">
              <option value="schedule">定时触发</option>
              <option value="project_stale">项目停滞</option>
              <option value="task_due">任务到期</option>
            </select>
            <select
              v-if="automationDrafts[Number(automation.id)].triggerType === 'schedule'"
              v-model="automationDrafts[Number(automation.id)].scheduleType"
              aria-label="调度类型"
            >
              <option value="hourly">每小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select>
            <select
              v-if="automationDrafts[Number(automation.id)].triggerType === 'schedule' && automationDrafts[Number(automation.id)].scheduleType === 'weekly'"
              v-model="automationDrafts[Number(automation.id)].weekday"
              aria-label="每周日期"
            >
              <option v-for="day in weekdayOptions" :key="day.value" :value="day.value">{{ day.label }}</option>
            </select>
            <input
              v-if="automationDrafts[Number(automation.id)].triggerType === 'schedule' && automationDrafts[Number(automation.id)].scheduleType !== 'hourly'"
              v-model="automationDrafts[Number(automation.id)].scheduleTime"
              aria-label="调度时间"
              type="time"
            >
            <select
              v-if="automationDrafts[Number(automation.id)].triggerType === 'project_stale'"
              v-model.number="automationDrafts[Number(automation.id)].projectId"
              aria-label="停滞项目"
            >
              <option :value="null">选择项目</option>
              <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
            <input
              v-if="automationDrafts[Number(automation.id)].triggerType === 'project_stale'"
              v-model.number="automationDrafts[Number(automation.id)].staleHours"
              aria-label="停滞小时数"
              type="number"
              min="1"
              max="8760"
            >
            <select
              v-if="automationDrafts[Number(automation.id)].triggerType === 'task_due'"
              v-model.number="automationDrafts[Number(automation.id)].taskId"
              aria-label="到期任务"
            >
              <option :value="null">选择有截止时间的任务</option>
              <option v-for="todo in todos" :key="todo.id" :value="todo.id">{{ todo.title }}</option>
            </select>
            <input v-model="automationDrafts[Number(automation.id)].timezone" aria-label="时区">
            <input
              v-model.number="automationDrafts[Number(automation.id)].maxRetries"
              aria-label="最大重试次数"
              type="number"
              min="0"
              max="5"
            >
            <input
              v-model.number="automationDrafts[Number(automation.id)].retryDelaySeconds"
              aria-label="重试延迟秒数"
              type="number"
              min="10"
              max="86400"
            >
            <label class="toggle-line">
              <input v-model="automationDrafts[Number(automation.id)].notifyOnFailure" type="checkbox">
              失败通知
            </label>
            <select v-model="automationDrafts[Number(automation.id)].status" aria-label="自动化状态">
              <option value="paused">暂停</option>
              <option value="enabled">启用</option>
            </select>
            <button class="secondary" type="button" @click="saveAutomationConfig(automation)">保存配置</button>
          </div>
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
        <h2>运行记录</h2>
        <div class="run-history">
          <div>
            <h3>Workflow Runs</h3>
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
                  <button class="secondary" type="button" @click="toggleWorkflowRun(run)">
                    {{ expandedWorkflowRunId === Number(run.id) ? '收起' : '详情' }}
                  </button>
                  <button v-if="run.status === 'paused'" type="button" @click="resumeWorkflowRun(run)">确认继续</button>
                  <button
                    v-if="run.status === 'paused' && workflowNeedsSecondConfirmation(run)"
                    class="danger-confirm"
                    type="button"
                    @click="resumeWorkflowRun(run, true)"
                  >二次确认继续</button>
                  <button v-if="run.status === 'failed'" class="secondary" type="button" @click="retryWorkflowRun(run)">重试</button>
                  <button v-if="run.status === 'paused' || run.status === 'running'" class="secondary" type="button" @click="cancelWorkflowRun(run)">取消</button>
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
            <h3>Automation Runs</h3>
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
        <h2>执行审计</h2>
        <div v-for="entry in audit" :key="entry.id" class="audit-row">
          <span>{{ entry.executorType }} / {{ entry.executorName }}</span>
          <span class="badge">{{ entry.riskLevel }}</span>
          <span class="muted">{{ entry.status }}</span>
          <span>{{ entry.outputSummary }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
