<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, ChevronDown, ChevronRight, CircleAlert, FileText, FolderSearch, GitBranch, LoaderCircle, PencilLine, Plug, RefreshCw, Search } from '@lucide/vue'
import {
  listConnectorResources,
  listConnectors,
  previewConnectorCreate,
  searchConnector
} from '@/api/app'
import type { ConnectorInfo, ConnectorItem, ConnectorResult } from '@/api/types'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const connectors = ref<ConnectorInfo[]>([])
const selectedName = ref('local_docs')
const result = ref<ConnectorResult | null>(null)
const loading = ref(true)
const error = ref('')
const showPreview = ref(false)
const lastAction = ref<'read' | 'search' | 'preview'>('read')
const query = ref('')
const repo = ref('')
const state = ref('open')
const createForm = ref({
  title: '',
  content: '',
  repo: '',
  body: ''
})

const selectedConnector = computed(() => connectors.value.find((item) => item.name === selectedName.value))
const canPreviewCreate = computed(() => selectedConnector.value?.capabilities.includes('preview_create'))

onMounted(refresh)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await listConnectors()
    connectors.value = response.data.items
    if (!connectors.value.some((item) => item.name === selectedName.value)) {
      selectedName.value = connectors.value[0]?.name || ''
    }
    result.value = null
    if (selectedConnector.value) await listResources()
  } catch (exception) {
    error.value = requestError(exception, '连接器加载失败')
  } finally {
    loading.value = false
  }
}

async function listResources() {
  if (!selectedConnector.value) return
  lastAction.value = 'read'
  loading.value = true
  error.value = ''
  try {
    const response = await listConnectorResources(selectedName.value, {
      repo: selectedName.value === 'github' ? repo.value : undefined,
      state: selectedName.value === 'github' ? state.value : undefined,
      limit: 50
    })
    result.value = response.data
  } catch (exception) {
    error.value = requestError(exception, '连接器读取失败')
  } finally {
    loading.value = false
  }
}

async function runSearch() {
  if (!selectedConnector.value) return
  if (!query.value.trim()) {
    await listResources()
    return
  }
  loading.value = true
  lastAction.value = 'search'
  error.value = ''
  try {
    const response = await searchConnector(selectedName.value, {
      q: query.value,
      repo: selectedName.value === 'github' ? repo.value : undefined,
      limit: 30
    })
    result.value = response.data
  } catch (exception) {
    error.value = requestError(exception, '连接器搜索失败')
  } finally {
    loading.value = false
  }
}

async function previewCreate() {
  if (!canPreviewCreate.value || !createForm.value.title.trim()) return
  loading.value = true
  lastAction.value = 'preview'
  error.value = ''
  try {
    const payload = selectedName.value === 'github'
      ? {
          repo: createForm.value.repo,
          title: createForm.value.title,
          body: createForm.value.body,
          sourceText: createForm.value.title
        }
      : {
          title: createForm.value.title,
          content: createForm.value.content,
          sourceText: createForm.value.title
        }
    const response = await previewConnectorCreate(selectedName.value, payload)
    result.value = response.data
  } catch (exception) {
    error.value = requestError(exception, '待确认操作生成失败')
  } finally {
    loading.value = false
  }
}

function selectConnector(name: string) {
  selectedName.value = name
  result.value = null
  query.value = ''
  showPreview.value = false
  listResources()
}

function connectorIcon(name: string) {
  return name === 'github' ? GitBranch : name === 'local_docs' ? FileText : Plug
}

function capabilityText(capability: string) {
  return ({ search: '搜索资料', list: '列出资源', read: '读取内容', preview_create: '预览新建' } as Record<string, string>)[capability] || capability
}

function statusText(status: string) {
  return {
    connected: '已连接',
    needs_auth: '需授权',
    unavailable: '不可用'
  }[status] ?? status
}

function itemMeta(item: ConnectorItem) {
  const parts = [item.resourceType, item.state, item.author].filter(Boolean)
  return parts.join(' · ') || item.path || item.url || item.id
}

function requestError(exception: unknown, fallback: string) {
  const response = (exception as { response?: { data?: { detail?: string; message?: string } } }).response
  return response?.data?.detail || response?.data?.message || (exception instanceof Error ? exception.message : fallback)
}

defineExpose({ refresh, loading })
</script>

<template>
  <section class="page connector-page" :class="{ embedded }">
    <header v-if="!embedded" class="connector-header">
      <div>
        <h1>数据连接</h1>
        <p>浏览已连接的资料，找到工作需要的上下文。</p>
      </div>
      <button class="secondary" :disabled="loading" type="button" @click="refresh"><RefreshCw :size="15" />刷新</button>
    </header>

    <div v-if="error" class="connector-error" role="alert"><CircleAlert :size="18" /><p>{{ error }}</p><button class="secondary" :disabled="loading" type="button" @click="refresh">重试</button></div>

    <div v-if="loading && !connectors.length" class="connector-empty loading-state" role="status"><LoaderCircle :size="23" class="spinning" /><p>正在加载数据来源…</p></div>
    <div v-else-if="!connectors.length && !error" class="connector-empty"><span class="connector-empty-icon"><Plug :size="28" /></span><h3>还没有数据来源</h3><p>连接资料来源后，就可以在这里浏览和搜索内容。</p><RouterLink class="button-link" to="/connections">查看连接<ArrowRight :size="15" /></RouterLink></div>
    <div v-else-if="connectors.length" class="project-layout">
      <aside class="item project-sidebar">
        <div class="section-title">
          <h2>数据来源</h2>
          <span class="count-text">{{ connectors.length }}</span>
        </div>
        <div class="connector-source-list">
        <button
          v-for="connector in connectors"
          :key="connector.name"
          class="project-list-item"
          :class="{ active: selectedName === connector.name }"
          :aria-pressed="selectedName === connector.name"
          :disabled="loading"
          type="button"
          @click="selectConnector(connector.name)"
        >
          <component :is="connectorIcon(connector.name)" :size="19" aria-hidden="true" />
          <span class="connector-source-copy"><strong>{{ connector.label }}</strong><span class="source-status" :class="connector.status">{{ statusText(connector.status) }}</span></span>
          <ChevronRight :size="15" aria-hidden="true" />
        </button>
        </div>
        <button class="source-refresh" :disabled="loading" type="button" @click="refresh"><RefreshCw :size="14" :class="{ spinning: loading }" />刷新来源</button>
      </aside>

      <section v-if="selectedConnector" class="stack connector-detail" aria-label="连接器详情">
        <article class="item connector-overview">
          <div class="section-title">
            <div class="connector-overview-title"><span class="connector-logo"><component :is="connectorIcon(selectedConnector.name)" :size="23" /></span><div>
              <h2>{{ selectedConnector.label }}</h2>
              <p>{{ selectedConnector.message }}</p>
            </div></div>
            <span class="badge" :class="{ success: selectedConnector.status === 'connected', pending: selectedConnector.status === 'needs_auth' }">
              {{ statusText(selectedConnector.status) }}
            </span>
          </div>
          <div class="connector-capabilities"><span v-for="capability in selectedConnector.capabilities" :key="capability">{{ capabilityText(capability) }}</span><span v-if="!selectedConnector.capabilities.length">暂无已开放能力</span></div>
          <form class="connector-search" @submit.prevent="runSearch">
            <div v-if="selectedName === 'github'" class="github-filters"><label>仓库<input v-model="repo" placeholder="owner/repo" :disabled="loading" /></label><label>状态<select v-model="state" :disabled="loading"><option value="open">未关闭</option><option value="closed">已关闭</option><option value="all">全部</option></select></label></div>
            <label class="search-label">搜索资料<span class="search-field"><Search :size="17" /><input v-model="query" placeholder="搜索关键词，留空则列出" :disabled="loading" /></span></label>
            <div class="search-actions"><button :disabled="loading" type="submit"><Search :size="15" />搜索</button><button class="secondary" :disabled="loading" type="button" @click="listResources">列出</button><button v-if="canPreviewCreate" class="preview-toggle" type="button" :aria-expanded="showPreview" aria-controls="connector-create-preview" @click="showPreview = !showPreview"><PencilLine :size="15" />写操作预览<ChevronDown :size="14" :class="{ rotated: showPreview }" /></button></div>
          </form>
        </article>

        <article v-if="canPreviewCreate && showPreview" id="connector-create-preview" class="item connector-preview">
          <div class="section-title"><div><h2>写操作预览</h2><p>先检查内容，生成的操作需要你确认后才会执行。</p></div></div>
          <form class="stack" @submit.prevent="previewCreate"><label v-if="selectedName === 'github'">目标仓库<input v-model="createForm.repo" placeholder="owner/repo" :disabled="loading" /></label><label>标题<input v-model="createForm.title" placeholder="标题" :disabled="loading" /></label><label>{{ selectedName === 'github' ? 'Issue 内容' : '文档内容' }}<textarea v-if="selectedName === 'github'" v-model="createForm.body" rows="4" placeholder="Issue 内容" :disabled="loading" /><textarea v-else v-model="createForm.content" rows="4" placeholder="文档内容" :disabled="loading" /></label><div class="search-actions"><button :disabled="loading || !createForm.title.trim()" type="submit">生成待确认操作</button><button class="secondary" type="button" @click="showPreview = false">取消</button></div></form>
        </article>

        <article class="item connector-results" :aria-busy="loading">
          <div class="section-title">
            <h2>{{ lastAction === 'preview' ? '操作预览' : '读取结果' }}</h2>
            <span v-if="result?.ok && !loading" class="count-text">{{ result.items.length }} 条结果</span>
          </div>
          <div v-if="loading" class="connector-empty result-empty" role="status"><LoaderCircle :size="22" class="spinning" /><p>{{ lastAction === 'preview' ? '正在生成操作预览…' : '正在读取资料…' }}</p></div>
          <div v-else-if="result && !result.ok" class="connector-empty result-empty"><span class="connector-empty-icon"><CircleAlert :size="24" /></span><h3>暂时无法读取资料</h3><p>{{ result.error?.message || result.content || '请检查连接状态后重试。' }}</p><RouterLink class="text-link" to="/connections">查看连接状态<ArrowRight :size="14" /></RouterLink></div>
          <template v-else><p v-if="result?.content" class="result-summary">{{ result.content }}</p><RouterLink v-if="result?.operation" class="button-link" to="/operations">查看待确认操作<ArrowRight :size="15" /></RouterLink><div v-if="result?.items.length" class="resource-list"><div v-for="item in result.items" :key="item.id" class="resource-row"><FileText :size="18" /><div><strong>{{ item.title }}</strong><span>{{ itemMeta(item) }}</span><p v-if="item.snippet">{{ item.snippet }}</p><details v-if="item.content"><summary>查看内容</summary><p>{{ item.content }}</p></details></div></div></div><div v-else-if="!result?.operation && !error" class="connector-empty result-empty"><span class="connector-empty-icon"><FolderSearch :size="26" /></span><h3>{{ lastAction === 'search' ? '没有找到匹配资料' : '这里还没有资料' }}</h3><p>{{ lastAction === 'search' ? '试试更简短的关键词，或点击“列出”浏览当前来源。' : '当前来源返回的资料会显示在这里，可以先尝试搜索。' }}</p></div></template>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.connector-page { min-width: 0; width: 100%; max-width: 1180px; margin: 0 auto; gap: 20px; }
.connector-page.embedded { padding: 0; }
.connector-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }.connector-header h1 { margin: 0; font-size: 32px; font-weight: 650; }.connector-header p { margin: 8px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.connector-page .project-layout { grid-template-columns: 218px minmax(0, 1fr); gap: 20px; min-width: 0; }
.connector-page .item { min-width: 0; border: 1px solid var(--border); border-radius: 14px; padding: 22px; background: var(--surface); box-shadow: none; }
.connector-page .item h2 { margin: 0; color: var(--foreground); font-size: 16px; line-height: 1.5; font-weight: 650; }
.connector-page .section-title { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin: 0 0 18px; }
.connector-page .section-title p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.8; }
.connector-page .count-text { color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
.connector-page .project-sidebar { gap: 15px; padding: 18px 12px 11px; }.project-sidebar .section-title { margin: 0 5px; }.project-sidebar h2 { font-size: 14px; }
.connector-source-list { display: grid; gap: 5px; }
.connector-page .project-list-item { display: flex; align-items: center; gap: 11px; min-width: 0; border: 1px solid transparent; border-radius: 9px; padding: 12px 10px; background: transparent; color: var(--muted-foreground); text-align: left; box-shadow: none; }
.project-list-item > svg { flex-shrink: 0; }.project-list-item > svg:last-child { width: 13px; margin-left: auto; opacity: 0; }.connector-source-copy { display: grid; min-width: 0; gap: 5px; }.connector-source-copy strong { color: var(--foreground); font-size: 13px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }.connector-page .source-status { color: var(--muted-foreground); font-size: 11px; font-weight: 400; line-height: 1.5; }.connector-page .source-status.connected { color: var(--success-strong); }
.connector-page .project-list-item.active { background: var(--primary-soft); color: var(--primary); }.project-list-item.active strong { color: var(--primary); }.project-list-item.active > svg:last-child { opacity: 1; }.connector-page .project-list-item:hover { background: var(--surface-muted); }.connector-page .project-list-item.active:hover { background: var(--primary-soft); }
.connector-page button, .connector-page .button-link { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; border-radius: 8px; padding: 8px 13px; font-size: 13px; font-weight: 550; line-height: 1.5; box-shadow: none; }
.connector-page button.secondary { border: 1px solid var(--border); color: var(--foreground); background: var(--surface); }.connector-page button.secondary:hover { border-color: var(--primary-border); color: var(--primary); background: var(--primary-soft); }
.connector-page button:disabled { opacity: .6; cursor: not-allowed; }.connector-page button:focus-visible, .connector-page a:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.connector-page .source-refresh { width: 100%; min-height: 35px; margin-top: 4px; border: 0; border-top: 1px solid var(--border); border-radius: 0; padding: 13px 8px 3px; background: transparent; color: var(--muted-foreground); font-size: 12px; font-weight: 400; }
.connector-detail { min-width: 0; gap: 18px; }.connector-overview-title { display: flex; min-width: 0; gap: 13px; align-items: center; }.connector-overview-title > div { min-width: 0; }.connector-logo { display: grid; place-items: center; flex: 0 0 46px; height: 46px; border-radius: 12px; background: var(--primary-soft); color: var(--primary); }.connector-page .connector-overview-title h2 { font-size: 19px; }.connector-overview-title p { overflow-wrap: anywhere; }
.connector-page .badge { flex-shrink: 0; border-radius: 6px; padding: 4px 8px; background: var(--surface-muted); color: var(--muted-foreground); font-size: 11px; line-height: 1.5; }.connector-page .badge.success { background: var(--success-soft); color: var(--success-strong); }.connector-page .badge.pending { background: var(--warning-soft); color: var(--warning-strong); }
.connector-capabilities { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 21px; }.connector-capabilities span { border-radius: 5px; padding: 4px 8px; background: var(--surface-muted); color: var(--muted-foreground); font-size: 11px; line-height: 1.5; }
.connector-search { display: grid; gap: 14px; padding-top: 19px; border-top: 1px solid var(--border); }.connector-page label { display: grid; min-width: 0; gap: 7px; color: var(--foreground); font-size: 12px; line-height: 1.6; font-weight: 550; }.connector-page label input, .connector-page label select, .connector-page label textarea { min-width: 0; width: 100%; max-width: 100%; min-height: 40px; padding: 9px 11px; box-sizing: border-box; border-radius: 8px; font-size: 13px; font-weight: 400; line-height: 1.5; background: var(--surface); }.connector-page textarea { resize: vertical; }
.github-filters { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 13px; }.search-field { display: flex; align-items: center; gap: 9px; border: 1px solid var(--border); border-radius: 8px; padding: 0 11px; color: var(--muted-foreground); }.search-field:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft); }.connector-page .search-field input { border: 0; padding: 10px 0; background: transparent; outline: none; box-shadow: none; }.search-field svg { flex-shrink: 0; }
.search-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }.connector-page .preview-toggle { min-height: 34px; margin-left: auto; border: 0; padding: 6px 0 6px 8px; background: transparent; color: var(--muted-foreground); font-size: 12px; }.preview-toggle:hover { color: var(--primary); }.rotated { transform: rotate(180deg); }.connector-page .connector-preview { border-color: var(--primary-border); }.connector-preview .stack { gap: 15px; }
.connector-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 45px 20px; text-align: center; }.connector-empty-icon { display: grid; place-items: center; width: 56px; height: 56px; margin-bottom: 17px; border-radius: 15px; background: var(--primary-soft); color: var(--primary); }.connector-empty h3 { margin: 0; font-size: 16px; line-height: 1.6; }.connector-empty p { max-width: 360px; margin: 10px 0 20px; color: var(--muted-foreground); font-size: 13px; line-height: 1.8; }.connector-empty p:last-child { margin-bottom: 0; }.connector-page .result-empty { min-height: 190px; border: 0; padding: 24px 12px; }.connector-page .result-empty p { font-size: 12px; }
.connector-page .result-summary { margin: 0 0 16px; color: var(--muted-foreground); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }.resource-list { display: grid; gap: 0; }.resource-row { display: flex; gap: 12px; min-width: 0; border-top: 1px solid var(--border); padding: 18px 0; }.resource-row:last-child { padding-bottom: 0; }.resource-row > svg { flex-shrink: 0; color: var(--primary); margin-top: 3px; }.resource-row > div { display: grid; min-width: 0; gap: 7px; }.resource-row strong { color: var(--foreground); font-size: 14px; line-height: 1.7; font-weight: 550; overflow-wrap: anywhere; }.resource-row span, .resource-row p { margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }.resource-row details { margin-top: 4px; }.resource-row summary { cursor: pointer; color: var(--primary); font-size: 12px; }.resource-row details p { padding-top: 10px; white-space: pre-wrap; }
.connector-page .text-link { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; color: var(--primary); font-size: 12px; text-decoration: none; }.text-link:hover { text-decoration: underline; text-underline-offset: 4px; }
.connector-error { display: flex; align-items: center; gap: 12px; padding: 13px 15px; border: 1px solid var(--danger-border); border-radius: 10px; background: var(--danger-soft); color: var(--danger-strong); }.connector-error > svg { flex-shrink: 0; }.connector-error p { flex: 1; min-width: 0; margin: 0; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }.connector-error button { flex-shrink: 0; }
.loading-state, .result-empty > .spinning { color: var(--primary); }.spinning { animation: connector-spin 1s linear infinite; } @keyframes connector-spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
@media (max-width: 980px) { .connector-page .project-layout { grid-template-columns: 180px minmax(0, 1fr); gap: 16px; }.connector-page .item { padding: 19px; }.connector-page .project-sidebar { padding: 16px 9px 10px; }.connector-page .connector-overview > .section-title { flex-wrap: wrap; }.connector-page .connector-overview > .section-title > .badge { margin-left: 59px; } }
@media (max-width: 700px) { .connector-page .project-layout { grid-template-columns: minmax(0, 1fr); }.connector-page .project-sidebar { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 15px 12px; gap: 12px; }.project-sidebar .section-title { grid-column: 1; }.connector-source-list { grid-column: 1 / -1; grid-row: 2; grid-template-columns: repeat(2, minmax(0, 1fr)); }.connector-page .source-refresh { grid-column: 2; grid-row: 1; margin: 0; padding: 2px 5px; border: 0; min-height: 27px; width: auto; }.connector-page .project-list-item { padding: 10px 8px; gap: 8px; }.project-list-item > svg:last-child { display: none; }.connector-source-copy strong { font-size: 12px; }.connector-header h1 { font-size: 27px; }.connector-header p { font-size: 13px; } }
@media (max-width: 480px) { .connector-page .item { padding: 17px 15px; }.connector-page .project-sidebar { padding: 13px 9px; }.connector-page .connector-overview-title h2 { font-size: 17px; }.connector-logo { flex-basis: 40px; height: 40px; }.connector-overview-title { gap: 10px; }.connector-page .connector-overview > .section-title > .badge { margin-left: 50px; }.connector-page .github-filters { grid-template-columns: minmax(0, 1fr); }.connector-page .preview-toggle { margin-left: 0; padding-left: 0; }.connector-page .section-title { gap: 9px; }.connector-page button { font-size: 12px; }.connector-page .result-empty { padding: 22px 5px; }.connector-error { flex-wrap: wrap; gap: 9px; }.connector-error p { flex-basis: calc(100% - 40px); }.connector-error button { margin-left: 27px; } }
</style>
