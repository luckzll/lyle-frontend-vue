<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { confirmOperation, listConfirmations, listNeedsAttention, listExecutionResults, rejectOperation, retryWorkflowRun } from '@/api/app'
import type { ConfirmationInboxItem, ExecutionResultSummary } from '@/api/types'

const tab = ref<'confirmations' | 'results' | 'attention' | 'history'>('confirmations')
const confirmations = ref<ConfirmationInboxItem[]>([])
const results = ref<ExecutionResultSummary[]>([])
const attention = ref<ExecutionResultSummary[]>([])
const actingId = ref<number | null>(null)
const expanded = ref<number | null>(null)
const retryingId = ref<number | null>(null)
const pageLoading = ref(false)
const loadError = ref('')

async function load() {
  pageLoading.value = true
  loadError.value = ''
  try {
    const [a, b, c] = await Promise.all([listConfirmations(), listExecutionResults({ limit: 50 }), listNeedsAttention()])
    confirmations.value = a.data.items; results.value = b.data.items; attention.value = c.data.items
  } catch (error: any) {
    loadError.value = error?.response?.data?.message || error?.response?.data?.detail || '执行数据加载失败，请确认 AI 服务可用后重试。'
  } finally {
    pageLoading.value = false
  }
}
async function act(id: number, action: 'confirm' | 'reject') { actingId.value = id; try { action === 'confirm' ? await confirmOperation(id) : await rejectOperation(id); await load() } finally { actingId.value = null } }
async function handleResultAction(item: ExecutionResultSummary, action: { type: string }) {
  if (action.type === 'view') { expanded.value = expanded.value === item.id ? null : item.id; return }
  if (action.type !== 'retry' || item.sourceType !== 'workflow_run') return
  retryingId.value = item.id
  try { await retryWorkflowRun(Number(item.sourceId)); await load() } finally { retryingId.value = null }
}
const statusText = (status: string) => ({ completed: '已完成', partial: '部分完成', failed: '未完成', awaiting_confirmation: '等待确认' }[status] || status)
onMounted(load)
</script>

<template><div class="page experience-page"><header class="page-header"><div><p class="eyebrow">结果、影响、下一步</p><h1>执行中心</h1><p class="muted">先看结论，技术细节按需展开。</p></div><RouterLink class="button-link" to="/automations">创建自动化</RouterLink></header>
  <section v-if="pageLoading" class="empty-state"><h2>正在加载执行数据</h2><p>正在同步结果与待确认操作。</p></section>
  <section v-else-if="loadError" class="empty-state error-state"><h2>执行中心加载失败</h2><p>{{ loadError }}</p><button type="button" @click="load">重试</button></section>
  <template v-else>
  <nav class="experience-tabs" aria-label="执行中心分区"><button v-for="item in [{id:'confirmations',label:`待我确认 ${confirmations.length}`},{id:'results',label:'最新结果'},{id:'attention',label:`需要处理 ${attention.length}`},{id:'history',label:'历史记录'}]" :key="item.id" :class="{active:tab===item.id}" @click="tab=item.id as any">{{ item.label }}</button></nav>
  <section v-if="tab==='confirmations'" class="result-list"><div v-if="!confirmations.length" class="empty-state"><h2>没有等待确认的操作</h2><p>需要你决定的写操作会集中出现在这里。</p></div><article v-for="item in confirmations" :key="item.pendingOperationId" class="result-card confirmation"><div class="row between"><span class="status-pill warning">{{ item.riskLevel }} · 待确认</span><span class="muted">{{ item.source }}</span></div><h2>{{ item.actionTitle }}</h2><p>{{ item.reason }}</p><div class="impact"><strong>影响范围</strong><span>{{ item.impactResources.join('、') }}</span></div><p v-if="!item.reversible" class="danger-text">此操作可能无法撤销，确认时会再次提示。</p><div class="row"><button :disabled="actingId===item.pendingOperationId" @click="act(item.pendingOperationId,'confirm')">确认执行</button><button class="secondary" :disabled="actingId===item.pendingOperationId" @click="act(item.pendingOperationId,'reject')">忽略</button></div></article></section>
  <section v-else class="result-list"><div v-if="(tab==='attention'?attention:results).length===0" class="empty-state"><h2>{{ tab==='attention'?'没有需要处理的结果':'还没有执行结果' }}</h2><RouterLink class="button-link" to="/automations">运行首次巡检</RouterLink></div><article v-for="item in (tab==='attention'?attention:results)" :key="item.id" class="result-card"><div class="row between"><span class="status-pill" :class="item.status">{{ statusText(item.status) }}</span><time class="muted">{{ new Date(item.createdAt).toLocaleString() }}</time></div><h2>{{ item.title }}</h2><p class="conclusion">{{ item.conclusion }}</p><div v-if="item.completedItems.length"><strong>已完成</strong><ul><li v-for="done in item.completedItems" :key="done">{{ done }}</li></ul></div><div v-if="item.risks.length" class="risk-box"><strong>风险或阻塞</strong><ul><li v-for="risk in item.risks" :key="risk">{{ risk }}</li></ul></div><div class="row"><button v-for="action in item.recommendedActions" :key="action.type" :disabled="action.type==='retry' && retryingId===item.id" :class="{secondary:action.type==='view'}" @click="handleResultAction(item, action)">{{ action.type==='retry' && retryingId===item.id ? '重试中…' : action.label }}</button><button class="link-button" @click="expanded=expanded===item.id?null:item.id">{{ expanded===item.id?'收起':'技术详情' }}</button></div><div v-if="expanded===item.id" class="technical"><code>{{ item.traceRef }}</code><span> · {{ item.durationMs ?? '—' }} ms</span><p>数据范围：{{ item.dataScope.join('、') }}</p></div></article></section>
  </template>
</div></template>
