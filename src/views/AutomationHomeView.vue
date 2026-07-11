<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createDraftFromIntent, createDraftFromTemplate, deleteAutomation, discardDraft as discardDraftRequest, enableAutomation, enableDraft as enableDraftRequest, getOnboarding, listAutomations, listExperienceTemplates, pauseAutomation, runAutomation as runAutomationRequest, runFirstInspection, updateOnboarding } from '@/api/app'
import type { AutomationDraft, AutomationTemplate, AutomationSummary } from '@/api/types'

const templates = ref<AutomationTemplate[]>([])
const automations = ref<AutomationSummary[]>([])
const onboarding = ref<Record<string, any> | null>(null)
const draft = ref<AutomationDraft | null>(null)
const intent = ref('')
const selectedProjectId = ref<number | undefined>()
const selectedWorkspaceId = ref<number | undefined>()
const loading = ref(false)
const pageLoading = ref(false)
const loadError = ref('')
const feedback = ref('')
const automationsError = ref('')
const actingAutomationId = ref<number | null>(null)
const pendingDeleteId = ref<number | null>(null)
const route = useRoute()
const router = useRouter()
const showWizard = computed(() => onboarding.value && !onboarding.value.completedAt && !onboarding.value.skippedAt)

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
    loadError.value = error?.response?.data?.message || error?.response?.data?.detail || '自动化数据加载失败，请确认 AI 服务可用后重试。'
  } finally {
    pageLoading.value = false
  }
}

async function loadAutomations() {
  automationsError.value = ''
  try {
    automations.value = (await listAutomations()).data.items
  } catch (error: any) {
    automationsError.value = error?.response?.data?.message || error?.response?.data?.detail || '我的自动化加载失败，请稍后重试。'
  }
}

async function runAutomation(item: AutomationSummary) {
  actingAutomationId.value = item.id
  feedback.value = ''
  try {
    await runAutomationRequest(item.id)
    feedback.value = `“${item.name}”已运行一次，结果将在执行中心展示。`
    await loadAutomations()
  } catch (error: any) {
    feedback.value = error?.response?.data?.message || error?.response?.data?.detail || '自动化运行失败，请稍后重试。'
  } finally {
    actingAutomationId.value = null
  }
}

async function toggleAutomation(item: AutomationSummary) {
  actingAutomationId.value = item.id
  feedback.value = ''
  try {
    if (item.status === 'enabled') await pauseAutomation(item.id)
    else await enableAutomation(item.id)
    feedback.value = `“${item.name}”已${item.status === 'enabled' ? '暂停' : '恢复'}。`
    await loadAutomations()
  } catch (error: any) {
    feedback.value = error?.response?.data?.message || error?.response?.data?.detail || '自动化状态更新失败，请稍后重试。'
  } finally {
    actingAutomationId.value = null
  }
}

async function confirmDeleteAutomation(item: AutomationSummary) {
  actingAutomationId.value = item.id
  feedback.value = ''
  try {
    await deleteAutomation(item.id)
    feedback.value = `“${item.name}”已删除。`
    pendingDeleteId.value = null
    await loadAutomations()
  } catch (error: any) {
    feedback.value = error?.response?.data?.message || error?.response?.data?.detail || '自动化删除失败，请稍后重试。'
  } finally {
    actingAutomationId.value = null
  }
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '尚未安排'
}

async function firstRun() {
  loading.value = true; feedback.value = ''
  try {
    await runFirstInspection({ projectId: selectedProjectId.value, workspaceId: selectedWorkspaceId.value })
    feedback.value = '首次项目巡检已完成，结果已进入执行中心。'
    await load()
  } catch (error: any) { feedback.value = error?.response?.data?.message || '巡检未完成，请检查项目与工作区。' }
  finally { loading.value = false }
}

async function skip() { try { await updateOnboarding({ action: 'skip' }); await load() } catch (error: any) { feedback.value = error?.response?.data?.message || '暂时无法更新引导状态。' } }
async function reopen() { try { await updateOnboarding({ action: 'reopen' }); await load() } catch (error: any) { feedback.value = error?.response?.data?.message || '暂时无法重新打开引导。' } }

async function chooseTemplate(item: AutomationTemplate) {
  if (item.availability === 'coming_soon') return
  feedback.value = ''
  try {
    const response = await createDraftFromTemplate({ templateId: item.id, projectId: selectedProjectId.value, workspaceId: selectedWorkspaceId.value })
    draft.value = response.data
  } catch (error: any) {
    feedback.value = error?.response?.data?.message || error?.response?.data?.detail || '模板预览生成失败，请稍后重试。'
  }
}

async function parseIntent() {
  if (!intent.value.trim()) return
  loading.value = true; feedback.value = ''
  try {
    const response = await createDraftFromIntent({ text: intent.value, projectId: selectedProjectId.value, workspaceId: selectedWorkspaceId.value })
    if (response.data.kind === 'draft') draft.value = response.data.draft || null
    else feedback.value = response.data.unsupportedReason || '暂时无法创建这个自动化。'
  } catch (error: any) {
    feedback.value = error?.response?.data?.message || error?.response?.data?.detail || '自动化预览生成失败，请稍后重试。'
  } finally { loading.value = false }
}

async function enableDraft() {
  if (!draft.value) return
  loading.value = true
  try { const response = await enableDraftRequest(draft.value.id); draft.value = null; feedback.value = `“${response.data.draft.title}”已启用。`; await loadAutomations() }
  catch (error: any) { feedback.value = error?.response?.data?.message || error?.response?.data?.detail || '自动化启用失败，请稍后重试。' }
  finally { loading.value = false }
}

async function discardDraft() { if (draft.value) await discardDraftRequest(draft.value.id); draft.value = null }
onMounted(async () => {
  await load()
  const queryIntent = typeof route.query.intent === 'string' ? route.query.intent : ''
  if (queryIntent) {
    intent.value = queryIntent
    await parseIntent()
    await router.replace({ path: '/automations' })
  }
})
</script>

<template>
  <div class="page experience-page">
    <header class="page-header"><div><p class="eyebrow">结果型自动化</p><h1>自动化</h1><p class="muted">说出想持续获得的结果，Lyle 会用安全模板帮你配置。</p></div><RouterLink class="button-link" to="/execution-center">查看执行结果</RouterLink></header>

    <section v-if="pageLoading" class="empty-state"><h2>正在加载自动化</h2><p>正在读取模板与首次巡检配置。</p></section>
    <section v-else-if="loadError" class="empty-state error-state"><h2>自动化加载失败</h2><p>{{ loadError }}</p><button type="button" @click="load">重试</button></section>
    <template v-else>
    <section v-if="showWizard" class="experience-hero">
      <div><span class="status-pill">首次成功 · 全程只读</span><h2>先完成一次项目巡检</h2><p>检查项目进展、逾期事项和工作区状态，不会修改文件或外部系统。</p></div>
      <div class="experience-grid two">
        <label>项目<select v-model="selectedProjectId"><option :value="undefined">暂不关联项目</option><option v-for="item in onboarding?.candidates?.projects" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label>已授权工作区<select v-model="selectedWorkspaceId"><option :value="undefined">仅检查项目数据</option><option v-for="item in onboarding?.candidates?.workspaces" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      </div>
      <div class="row"><button type="button" :disabled="loading" @click="firstRun">{{ loading ? '巡检中…' : '运行一次项目巡检' }}</button><button class="secondary" type="button" @click="skip">稍后设置</button></div>
    </section>

    <section v-else-if="onboarding" class="compact-banner"><span>首次巡检引导已完成或稍后处理。</span><button class="secondary" type="button" @click="reopen">重新打开引导</button></section>
    <p v-if="feedback" class="notice">{{ feedback }}</p>

    <section class="card"><h2>用一句话创建</h2><p class="muted">例如：每周五下午五点检查 Lyle 项目进展和逾期任务，生成周报。</p><div class="intent-row"><input v-model="intent" placeholder="我想定期得到…" @keyup.enter="parseIntent"><button type="button" :disabled="loading || !intent.trim()" @click="parseIntent">生成预览</button></div></section>

    <section class="my-automations-section">
      <div class="section-title">
        <div><h2>我的自动化</h2><p class="muted">在日常入口运行、暂停或删除；复杂参数仍在高级设置中管理。</p></div>
        <RouterLink class="button-link secondary" to="/advanced-settings?tab=automations">高级配置</RouterLink>
      </div>
      <div v-if="automationsError" class="empty-state error-state compact"><h3>我的自动化加载失败</h3><p>{{ automationsError }}</p><button type="button" @click="loadAutomations">重试</button></div>
      <div v-else-if="automations.length" class="experience-grid automations">
        <article v-for="item in automations" :key="item.id" class="template-card automation-summary-card">
          <div class="row between"><span class="status-pill" :class="item.status">{{ item.status === 'enabled' ? '运行中' : item.status === 'paused' ? '已暂停' : item.status }}</span><span v-if="item.consecutiveFailures" class="danger-text">连续失败 {{ item.consecutiveFailures }} 次</span></div>
          <h3>{{ item.name }}</h3>
          <p class="muted">{{ item.triggerType || 'schedule' }}{{ item.scheduleExpr ? ` · ${item.scheduleExpr}` : '' }}{{ item.timezone ? ` · ${item.timezone}` : '' }}</p>
          <dl><dt>下次运行</dt><dd>{{ formatTime(item.nextRunAt) }}</dd><dt>上次运行</dt><dd>{{ formatTime(item.lastRunAt) }}</dd></dl>
          <div class="automation-card-actions">
            <button type="button" :disabled="actingAutomationId === item.id" @click="runAutomation(item)">运行一次</button>
            <button class="secondary" type="button" :disabled="actingAutomationId === item.id" @click="toggleAutomation(item)">{{ item.status === 'enabled' ? '暂停' : '恢复' }}</button>
            <button v-if="pendingDeleteId !== item.id" class="secondary danger" type="button" :disabled="actingAutomationId === item.id" @click="pendingDeleteId = item.id">删除</button>
            <template v-else><button class="danger-confirm" type="button" :disabled="actingAutomationId === item.id" @click="confirmDeleteAutomation(item)">确认删除</button><button class="secondary" type="button" @click="pendingDeleteId = null">取消</button></template>
          </div>
        </article>
      </div>
      <div v-else class="empty-state compact"><h3>还没有启用的自动化</h3><p>从下方模板选择一个，或用一句话创建。</p></div>
    </section>

    <section><div class="section-title"><div><h2>结果模板</h2><p class="muted">模板只生成经过审查的只读流程。</p></div></div><div class="experience-grid templates"><article v-for="item in templates" :key="item.id" class="template-card" :class="{ disabled: item.availability === 'coming_soon' }"><div class="row between"><span class="status-pill">{{ item.category }}</span><span v-if="item.availability" class="muted">即将支持</span></div><h3>{{ item.name }}</h3><p>{{ item.problem }}</p><dl><dt>会读取</dt><dd>{{ item.sources.join('、') }}</dd><dt>产出</dt><dd>{{ item.output }}</dd><dt>默认频率</dt><dd>{{ item.defaultSchedule }}</dd><dt>预计耗时</dt><dd>{{ item.estimatedDuration }}</dd></dl><button type="button" :disabled="!!item.availability" @click="chooseTemplate(item)">使用此模板</button></article></div></section>

    <div v-if="draft" class="drawer-backdrop" @click.self="discardDraft"><aside class="draft-drawer" role="dialog" aria-modal="true" aria-labelledby="draft-title"><p class="eyebrow">启用前预览</p><h2 id="draft-title">{{ draft.title }}</h2><div class="preview-block"><strong>运行时间</strong><p>{{ draft.schedule }} · {{ draft.timezone }}</p></div><div class="preview-block"><strong>会读取</strong><p>{{ draft.allowedSources.join('、') }}</p></div><div class="preview-block safe"><strong>权限与写操作</strong><p>{{ draft.riskSummary.message }}</p></div><p class="muted">启用后才会创建工作流与自动化；此预览不会执行任何操作。</p><div class="drawer-actions"><button type="button" :disabled="loading" @click="enableDraft">{{ loading ? '启用中…' : '确认启用' }}</button><button class="secondary" type="button" @click="discardDraft">取消</button><RouterLink class="button-link secondary" to="/advanced-settings?tab=workflows">高级编辑</RouterLink></div></aside></div>
    </template>
  </div>
</template>
