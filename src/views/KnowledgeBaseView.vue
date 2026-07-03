<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  createKnowledgeBase,
  debugRag,
  deleteKnowledgeBase,
  deleteKnowledgeFile,
  listRagChunks,
  listKnowledgeBases,
  listKnowledgeFiles,
  rebuildKnowledgeBaseFiles,
  rebuildKnowledgeFile,
  uploadKnowledgeFile
} from '@/api/app'
import type { KnowledgeBase, KnowledgeFile, RagChunkResponse, RagDebugResponse } from '@/api/types'

const name = ref('默认知识库')
const loading = ref(false)
const pageLoading = ref(true)
const error = ref('')
const notice = ref('')
const memoryNotice = ref('')
const knowledgeBases = ref<KnowledgeBase[]>([])
const selectedKnowledgeBaseId = ref<string>()
const files = ref<KnowledgeFile[]>([])
const ragQuestion = ref('这份文档讲了什么？')
const ragDebug = ref<RagDebugResponse | null>(null)
const ragChunks = ref<RagChunkResponse['items']>([])
const rebuildingFileIds = ref<Set<string>>(new Set())
const selectedKnowledgeBase = computed(() =>
  knowledgeBases.value.find((item) => item.id === selectedKnowledgeBaseId.value)
)

async function refreshKnowledgeBases() {
  error.value = ''
  try {
    const response = await listKnowledgeBases()
    knowledgeBases.value = response.data
    if (!selectedKnowledgeBaseId.value && response.data.length > 0) {
      selectedKnowledgeBaseId.value = response.data[0].id
      await refreshFiles()
    }
  } catch {
    error.value = '知识库列表加载失败，请确认后端服务已经启动。'
  } finally {
    pageLoading.value = false
  }
}

async function create() {
  if (!name.value.trim()) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const response = await createKnowledgeBase(name.value.trim())
    selectedKnowledgeBaseId.value = response.data.id
    name.value = ''
    notice.value = '知识库已创建。'
    await refreshKnowledgeBases()
    await refreshFiles()
  } catch {
    error.value = '知识库创建失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function refreshFiles() {
  if (!selectedKnowledgeBaseId.value) {
    files.value = []
    ragChunks.value = []
    return
  }
  error.value = ''
  try {
    const response = await listKnowledgeFiles(selectedKnowledgeBaseId.value)
    files.value = response.data
    await refreshChunks()
  } catch {
    error.value = '文件列表加载失败。'
  }
}

async function removeKnowledgeBase(id: string) {
  const target = knowledgeBases.value.find((item) => item.id === id)
  if (!window.confirm(`删除知识库「${target?.name || id}」？`)) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    await deleteKnowledgeBase(id)
    if (selectedKnowledgeBaseId.value === id) {
      selectedKnowledgeBaseId.value = undefined
      files.value = []
      ragChunks.value = []
      ragDebug.value = null
    }
    notice.value = '知识库已删除。'
    await refreshKnowledgeBases()
  } catch {
    error.value = '知识库删除失败。'
  } finally {
    loading.value = false
  }
}

async function removeFile(fileId: string) {
  if (!selectedKnowledgeBaseId.value) return
  const target = files.value.find((item) => item.id === fileId)
  if (!window.confirm(`删除文件「${target?.fileName || fileId}」？`)) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    await deleteKnowledgeFile(selectedKnowledgeBaseId.value, fileId)
    notice.value = '文件已删除。'
    await refreshFiles()
  } catch {
    error.value = '文件删除失败。'
  } finally {
    loading.value = false
  }
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !selectedKnowledgeBaseId.value) return

  loading.value = true
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  try {
    const response = await uploadKnowledgeFile(selectedKnowledgeBaseId.value, file)
    notice.value = '文件已上传并完成入库。'
    setMemoryNotice(response.data.candidateMemories?.length || 0)
    await refreshFiles()
  } catch {
    error.value = '文件上传或入库失败。'
  } finally {
    loading.value = false
    input.value = ''
  }
}

async function rebuildFile(fileId: string) {
  if (!selectedKnowledgeBaseId.value) return
  const next = new Set(rebuildingFileIds.value)
  next.add(fileId)
  rebuildingFileIds.value = next
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  try {
    const response = await rebuildKnowledgeFile(selectedKnowledgeBaseId.value, fileId)
    notice.value = '文件索引已重建。'
    setMemoryNotice(response.data.candidateMemories?.length || 0)
    await refreshFiles()
  } catch {
    error.value = '文件索引重建失败。'
  } finally {
    const remaining = new Set(rebuildingFileIds.value)
    remaining.delete(fileId)
    rebuildingFileIds.value = remaining
  }
}

async function rebuildAllFiles() {
  if (!selectedKnowledgeBaseId.value || files.value.length === 0) return
  if (!window.confirm(`重建「${selectedKnowledgeBase.value?.name || selectedKnowledgeBaseId.value}」下全部文件索引？`)) return
  loading.value = true
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  try {
    const response = await rebuildKnowledgeBaseFiles(selectedKnowledgeBaseId.value)
    notice.value = '知识库索引已重建。'
    const count = response.data.reduce((total, item) => total + (item.candidateMemories?.length || 0), 0)
    setMemoryNotice(count)
    await refreshFiles()
  } catch {
    error.value = '知识库索引重建失败。'
  } finally {
    loading.value = false
  }
}

async function runRagDebug() {
  if (!selectedKnowledgeBaseId.value || !ragQuestion.value.trim()) return
  loading.value = true
  error.value = ''
  try {
    const response = await debugRag(ragQuestion.value.trim(), [selectedKnowledgeBaseId.value])
    ragDebug.value = response.data
  } catch {
    error.value = 'RAG 调试失败。'
  } finally {
    loading.value = false
  }
}

async function refreshChunks() {
  if (!selectedKnowledgeBaseId.value) return
  const response = await listRagChunks(selectedKnowledgeBaseId.value, 20)
  ragChunks.value = response.data.items
}

async function selectKnowledgeBase(id: string) {
  selectedKnowledgeBaseId.value = id
  ragDebug.value = null
  await refreshFiles()
}

function statusText(status: string) {
  if (status === 'completed') return '已入库'
  if (status === 'queued') return '排队中'
  if (status === 'failed') return '失败'
  return status
}

function statusClass(status: string) {
  return {
    danger: status === 'failed',
    pending: status === 'queued',
    success: status === 'completed'
  }
}

function setMemoryNotice(count: number) {
  memoryNotice.value = count > 0
    ? `已从文件中识别出 ${count} 条候选记忆，请到记忆页确认后再写入长期记忆。`
    : ''
}

onMounted(refreshKnowledgeBases)
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>知识库</h1>
        <p class="muted">上传资料、检查入库状态，并调试 RAG 命中结果。</p>
      </div>
      <button class="secondary" type="button" :disabled="pageLoading" @click="refreshKnowledgeBases">刷新</button>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="notice" class="alert success">{{ notice }}</p>
    <p v-if="memoryNotice" class="alert success">
      {{ memoryNotice }}
      <a class="inline-link" href="/memory">查看待确认记忆</a>
    </p>

    <div class="kb-layout">
      <aside class="panel kb-sidebar">
        <div class="kb-create">
          <input v-model="name" data-testid="knowledge-name-input" placeholder="知识库名称" />
          <button data-testid="create-knowledge-button" :disabled="loading || !name.trim()" @click="create">创建</button>
        </div>

        <div v-if="pageLoading" class="empty-state compact">
          <strong>正在加载</strong>
          <span>读取知识库列表。</span>
        </div>
        <div v-else-if="knowledgeBases.length === 0" class="empty-state compact">
          <strong>暂无知识库</strong>
          <span>创建一个知识库后即可上传文件。</span>
        </div>
        <button
          v-for="item in knowledgeBases"
          :key="item.id"
          class="kb-list-item"
          :class="{ active: item.id === selectedKnowledgeBaseId }"
          type="button"
          @click="selectKnowledgeBase(item.id)"
        >
          <span>{{ item.name }}</span>
          <small>{{ item.id }}</small>
        </button>
      </aside>

      <main class="kb-main">
        <section class="panel item stack">
          <div class="section-title">
            <div>
              <h2>{{ selectedKnowledgeBase?.name || '选择知识库' }}</h2>
              <p class="muted">ID: {{ selectedKnowledgeBaseId || '-' }}</p>
            </div>
            <button
              v-if="selectedKnowledgeBaseId"
              class="secondary danger"
              type="button"
              :disabled="loading"
              @click="removeKnowledgeBase(selectedKnowledgeBaseId)"
            >
              删除知识库
            </button>
          </div>
          <div v-if="selectedKnowledgeBaseId" class="upload-zone">
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.log,.pdf,.docx"
              data-testid="knowledge-file-input"
              :disabled="loading"
              @change="upload"
            />
          </div>
          <div v-else class="empty-state compact">
            <strong>还没有选中知识库</strong>
            <span>从左侧选择一个知识库，或先创建新的知识库。</span>
          </div>
        </section>

        <section class="panel item stack">
          <div class="section-title">
            <div>
              <h2>文件</h2>
              <span class="badge">{{ files.length }} 个文件</span>
            </div>
            <button
              v-if="selectedKnowledgeBaseId && files.length > 0"
              class="secondary"
              type="button"
              :disabled="loading"
              @click="rebuildAllFiles"
            >
              重建全部索引
            </button>
          </div>
          <div v-if="!selectedKnowledgeBaseId" class="empty-state compact">
            <strong>暂无文件</strong>
            <span>选择知识库后显示文件列表。</span>
          </div>
          <div v-else-if="files.length === 0" class="empty-state compact">
            <strong>这个知识库还是空的</strong>
            <span>上传 txt、md、pdf 或 docx 文件后会自动入库。</span>
          </div>
          <article v-for="file in files" :key="file.id" class="file-row">
            <div>
              <strong>{{ file.fileName }}</strong>
              <p class="muted">
                {{ file.storageProvider || 'LEGACY' }} · {{ file.bucket || '-' }} · {{ file.objectKey || file.storagePath }}
              </p>
              <small class="memory-meta">
                {{ file.contentType || 'unknown' }} · {{ file.fileSize ? `${file.fileSize} bytes` : 'unknown size' }} · {{ file.visibility || 'private' }}
              </small>
            </div>
            <span class="badge" :class="statusClass(file.parseStatus)">{{ statusText(file.parseStatus) }}</span>
            <button
              class="secondary"
              type="button"
              :disabled="loading || rebuildingFileIds.has(file.id)"
              @click="rebuildFile(file.id)"
            >
              {{ rebuildingFileIds.has(file.id) ? '重建中' : '重建索引' }}
            </button>
            <button class="secondary danger" type="button" :disabled="loading" @click="removeFile(file.id)">删除</button>
          </article>
        </section>

        <section class="panel item stack">
          <div class="section-title">
            <h2>RAG 调试</h2>
            <button class="secondary" type="button" :disabled="!selectedKnowledgeBaseId" @click="refreshChunks">刷新分块</button>
          </div>
          <div class="row">
            <input v-model="ragQuestion" data-testid="rag-question-input" placeholder="输入要调试的问题" />
            <button data-testid="rag-debug-button" type="button" :disabled="!selectedKnowledgeBaseId || loading" @click="runRagDebug">
              {{ loading ? '调试中' : '调试检索' }}
            </button>
          </div>

          <div v-if="ragDebug" class="grid">
            <article class="item">
              <h3>改写 Query</h3>
              <p v-for="query in ragDebug.queries" :key="query" class="muted">{{ query }}</p>
            </article>
            <article class="item">
              <h3>充分性判断</h3>
              <pre>{{ JSON.stringify(ragDebug.sufficiency, null, 2) }}</pre>
            </article>
            <article v-if="ragDebug.attribution" class="item">
              <h3>Badcase 归因</h3>
              <p class="muted">
                {{ ragDebug.attribution.status }} · 命中 {{ ragDebug.attribution.contextCount }} 条 · 最高分 {{ ragDebug.attribution.topScore }}
              </p>
              <ul>
                <li v-for="reason in ragDebug.attribution.reasons" :key="reason">{{ reason }}</li>
              </ul>
              <p v-for="suggestion in ragDebug.attribution.suggestions" :key="suggestion" class="muted">{{ suggestion }}</p>
            </article>
            <article v-if="ragDebug.citationQuality" class="item">
              <h3>引用质量</h3>
              <p class="metric">{{ ragDebug.citationQuality.score }}</p>
              <p class="muted">{{ ragDebug.citationQuality.level }} · {{ ragDebug.citationQuality.reason }}</p>
            </article>
          </div>

          <div v-if="ragDebug" class="stack">
            <h3>命中文档片段</h3>
            <div v-if="ragDebug.contexts.length === 0" class="empty-state compact">
              <strong>没有命中文档</strong>
              <span>可以换一个问题，或确认文件已完成入库。</span>
            </div>
            <article v-for="context in ragDebug.contexts" :key="`${context.title}-${context.chunk}`" class="source-box">
              <strong>{{ context.title }}</strong>
              <span>score={{ context.score || '-' }} · backend={{ context.backend || '-' }} · query={{ context.query || '-' }}</span>
              <p>{{ context.chunk }}</p>
            </article>
          </div>

          <div class="stack">
            <h3>当前分块预览</h3>
            <article v-for="chunk in ragChunks" :key="`${chunk.doc_id}-${chunk.title}`" class="source-box">
              <strong>{{ chunk.title }}</strong>
              <span>{{ chunk.doc_id }} · {{ chunk.backend }}</span>
              <p>{{ chunk.chunk }}</p>
            </article>
            <div v-if="ragChunks.length === 0" class="empty-state compact">
              <strong>暂无可预览分块</strong>
              <span>如果使用 Qdrant 持久化，重启后内存预览可能为空，但向量检索仍可工作。</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  </section>
</template>
