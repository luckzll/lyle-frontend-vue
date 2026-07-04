<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  listConnectorResources,
  listConnectors,
  previewConnectorCreate,
  searchConnector
} from '@/api/app'
import type { ConnectorInfo, ConnectorItem, ConnectorResult } from '@/api/types'

const connectors = ref<ConnectorInfo[]>([])
const selectedName = ref('local_docs')
const result = ref<ConnectorResult | null>(null)
const loading = ref(false)
const error = ref('')
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
      selectedName.value = connectors.value[0]?.name || 'local_docs'
    }
    await listResources()
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : '连接器加载失败'
  } finally {
    loading.value = false
  }
}

async function listResources() {
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
  if (!query.value.trim()) {
    await listResources()
    return
  }
  loading.value = true
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
  loading.value = true
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
  listResources()
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
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>连接器</h1>
        <p class="muted">读取真实项目上下文，写操作先生成待确认项。</p>
      </div>
      <button class="secondary" :disabled="loading" type="button" @click="refresh">刷新</button>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>

    <div class="project-layout">
      <aside class="item project-sidebar">
        <div class="section-title">
          <h2>来源</h2>
          <span class="badge">{{ connectors.length }}</span>
        </div>
        <button
          v-for="connector in connectors"
          :key="connector.name"
          class="project-list-item"
          :class="{ active: selectedName === connector.name }"
          type="button"
          @click="selectConnector(connector.name)"
        >
          <strong>{{ connector.label }}</strong>
          <span>{{ statusText(connector.status) }}</span>
        </button>
      </aside>

      <main class="stack">
        <article v-if="selectedConnector" class="item">
          <div class="section-title">
            <div>
              <h2>{{ selectedConnector.label }}</h2>
              <p class="muted">{{ selectedConnector.message }}</p>
            </div>
            <span class="badge" :class="{ success: selectedConnector.status === 'connected', pending: selectedConnector.status === 'needs_auth' }">
              {{ statusText(selectedConnector.status) }}
            </span>
          </div>
          <div class="status-grid">
            <div>
              <span class="metric">{{ selectedConnector.capabilities.length }}</span>
              <span class="muted">能力</span>
            </div>
            <div>
              <span class="metric">{{ result?.items.length ?? 0 }}</span>
              <span class="muted">当前结果</span>
            </div>
            <div>
              <span class="metric">{{ result?.sources.length ?? 0 }}</span>
              <span class="muted">来源</span>
            </div>
          </div>
        </article>

        <div class="grid">
          <article class="item">
            <h2>读取</h2>
            <form class="stack" @submit.prevent="runSearch">
              <input v-model="query" placeholder="搜索关键词，留空则列出" />
              <input v-if="selectedName === 'github'" v-model="repo" placeholder="owner/repo" />
              <select v-if="selectedName === 'github'" v-model="state">
                <option value="open">open</option>
                <option value="closed">closed</option>
                <option value="all">all</option>
              </select>
              <span class="row">
                <button :disabled="loading" type="submit">搜索</button>
                <button class="secondary" :disabled="loading" type="button" @click="listResources">列出</button>
              </span>
            </form>
          </article>

          <article v-if="canPreviewCreate" class="item">
            <h2>写操作预览</h2>
            <form class="stack" @submit.prevent="previewCreate">
              <input v-if="selectedName === 'github'" v-model="createForm.repo" placeholder="owner/repo" />
              <input v-model="createForm.title" placeholder="标题" />
              <textarea
                v-if="selectedName === 'github'"
                v-model="createForm.body"
                rows="4"
                placeholder="Issue 内容"
              />
              <textarea v-else v-model="createForm.content" rows="4" placeholder="文档内容" />
              <button :disabled="loading || !createForm.title.trim()" type="submit">生成待确认操作</button>
            </form>
          </article>
        </div>

        <article class="item">
          <div class="section-title">
            <h2>读取结果</h2>
            <span class="badge">{{ result?.ok ? 'ok' : result?.error?.code || 'idle' }}</span>
          </div>
          <p v-if="result" class="muted">{{ result.content }}</p>
          <RouterLink v-if="result?.operation" class="button-link" to="/operations">查看待确认操作</RouterLink>
          <div v-if="result?.items.length" class="stack">
            <div v-for="item in result.items" :key="item.id" class="memory-row stacked">
              <strong>{{ item.title }}</strong>
              <span>{{ itemMeta(item) }}</span>
              <small v-if="item.snippet" class="memory-meta">{{ item.snippet }}</small>
              <small v-if="item.content" class="memory-meta">{{ item.content }}</small>
            </div>
          </div>
          <p v-else class="muted">暂无结果。</p>
        </article>
      </main>
    </div>
  </section>
</template>
