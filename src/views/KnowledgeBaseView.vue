<script setup lang="ts">
import axios from 'axios'
import { FileText, FileUp, Presentation, Table2 } from '@lucide/vue'
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
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import { isKnowledgeFileSupported, KNOWLEDGE_FILE_ACCEPT } from '@/domain/knowledge-file'

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
const pendingKnowledgeBaseDelete = ref<KnowledgeBase | null>(null)
const pendingFileDelete = ref<KnowledgeFile | null>(null)
const pendingRebuildAll = ref(false)
const showRetrievalTest = ref(false)
const showTechnicalDetails = ref(false)
const dragActive = ref(false)
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
  } catch {
    error.value = '文件列表加载失败。'
  }
}

async function removeKnowledgeBase(id: string) {
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
    pendingKnowledgeBaseDelete.value = null
    await refreshKnowledgeBases()
  } catch {
    error.value = '知识库删除失败。'
  } finally {
    loading.value = false
  }
}

async function removeFile(fileId: string) {
  if (!selectedKnowledgeBaseId.value) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    await deleteKnowledgeFile(selectedKnowledgeBaseId.value, fileId)
    notice.value = '文件已删除。'
    pendingFileDelete.value = null
    await refreshFiles()
  } catch {
    error.value = '文件删除失败。'
  } finally {
    loading.value = false
  }
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const selectedFiles = Array.from(input.files || [])
  await uploadFiles(selectedFiles)
  input.value = ''
}

async function dropFiles(event: DragEvent) {
  dragActive.value = false
  await uploadFiles(Array.from(event.dataTransfer?.files || []))
}

async function uploadFiles(selectedFiles: File[]) {
  if (!selectedFiles.length || !selectedKnowledgeBaseId.value || loading.value) return

  const unsupported = selectedFiles.filter((file) => !isKnowledgeFileSupported(file.name))
  if (unsupported.length) {
    error.value = `暂不支持：${unsupported.map((file) => file.name).join('、')}。请上传 PDF、DOCX、XLS/XLSX、PPTX 或文本文件。`
    return
  }

  loading.value = true
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  let completed = 0
  let candidateMemoryCount = 0
  const failures: string[] = []
  for (const file of selectedFiles) {
    try {
      const response = await uploadKnowledgeFile(selectedKnowledgeBaseId.value, file)
      completed += 1
      candidateMemoryCount += response.data.candidateMemories?.length || 0
    } catch (exception) {
      failures.push(`${file.name}：${uploadFailureMessage(exception)}`)
    }
  }
  if (completed) {
    notice.value = completed === 1 ? '文件已上传并完成入库。' : `${completed} 个文件已上传并完成入库。`
    setMemoryNotice(candidateMemoryCount)
    await refreshFiles()
  }
  if (failures.length) {
    error.value = failures.join('；')
  }
  loading.value = false
}

function uploadFailureMessage(exception: unknown) {
  if (axios.isAxiosError(exception)) {
    const data = exception.response?.data as { message?: string; detail?: string } | undefined
    const detail = String(data?.message || data?.detail || '').trim()
    if (detail) return detail
    if (exception.response?.status === 413) return '文件超过服务器允许的大小。'
  }
  return '上传或解析失败，请稍后重试。'
}

function leaveDropZone(event: DragEvent) {
  if (event.currentTarget === event.target) dragActive.value = false
}

function preventDropDefaults(event: DragEvent) {
  event.preventDefault()
  if (!loading.value) dragActive.value = true
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
  loading.value = true
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  try {
    const response = await rebuildKnowledgeBaseFiles(selectedKnowledgeBaseId.value)
    notice.value = '知识库索引已重建。'
    const count = response.data.reduce((total, item) => total + (item.candidateMemories?.length || 0), 0)
    setMemoryNotice(count)
    pendingRebuildAll.value = false
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
    error.value = '检索测试失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function refreshChunks() {
  if (!selectedKnowledgeBaseId.value) return
  const response = await listRagChunks(selectedKnowledgeBaseId.value, 20)
  ragChunks.value = response.data.items
}

async function toggleTechnicalDetails() {
  showTechnicalDetails.value = !showTechnicalDetails.value
  if (showTechnicalDetails.value && ragChunks.value.length === 0) {
    try {
      await refreshChunks()
    } catch {
      error.value = '技术检索详情暂时无法加载。'
    }
  }
}

async function selectKnowledgeBase(id: string) {
  selectedKnowledgeBaseId.value = id
  ragDebug.value = null
  ragChunks.value = []
  showRetrievalTest.value = false
  showTechnicalDetails.value = false
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

function formatFileSize(value?: number | null) {
  if (!value) return '大小未知'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

onMounted(refreshKnowledgeBases)
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>知识库</h1>
        <p class="muted">集中管理 Lyle 可以引用的文件和资料。</p>
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
          <small>{{ item.id === selectedKnowledgeBaseId ? '当前使用' : '点击打开' }}</small>
        </button>
      </aside>

      <section v-if="selectedKnowledgeBaseId" class="kb-main" aria-label="知识库详情">
        <section class="panel item stack">
          <div class="section-title">
            <div>
              <h2>{{ selectedKnowledgeBase?.name || '选择知识库' }}</h2>
              <p class="muted">上传文件后，Lyle 会在回答时按需引用。</p>
            </div>
            <button
              v-if="selectedKnowledgeBaseId"
              class="secondary danger"
              type="button"
              :disabled="loading"
              @click="pendingKnowledgeBaseDelete = selectedKnowledgeBase || null"
            >
              删除知识库
            </button>
          </div>
          <div
            class="upload-zone"
            :class="{ 'is-dragging': dragActive, 'is-busy': loading }"
            @dragenter="preventDropDefaults"
            @dragover="preventDropDefaults"
            @dragleave="leaveDropZone"
            @drop.prevent="dropFiles"
          >
            <div class="upload-zone__icon"><FileUp :size="22" aria-hidden="true" /></div>
            <div class="upload-zone__copy">
              <strong>{{ loading ? '正在解析并建立索引…' : '拖入资料，或选择文件' }}</strong>
              <span>支持文本型 PDF、Word、Excel、PowerPoint 和常见文本文件，可一次选择多个。</span>
            </div>
            <label class="upload-zone__button" :class="{ disabled: loading }">
              <input
                class="visually-hidden"
                type="file"
                :accept="KNOWLEDGE_FILE_ACCEPT"
                data-testid="knowledge-file-input"
                :disabled="loading"
                multiple
                @change="upload"
              />
              {{ loading ? '处理中' : '选择文件' }}
            </label>
            <div class="upload-formats" aria-label="支持的文件格式">
              <span><FileText :size="14" />PDF / DOCX</span>
              <span><Table2 :size="14" />XLS / XLSX</span>
              <span><Presentation :size="14" />PPTX</span>
            </div>
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
              @click="pendingRebuildAll = true"
            >
              重建全部索引
            </button>
          </div>
          <div v-if="files.length === 0" class="empty-state compact">
            <strong>这个知识库还是空的</strong>
            <span>上传 PDF、DOCX、XLS/XLSX、PPTX 或文本文件后会自动入库。</span>
          </div>
          <article v-for="file in files" :key="file.id" class="file-row">
            <div>
              <strong>{{ file.fileName }}</strong>
              <p class="muted">{{ formatFileSize(file.fileSize) }} · {{ statusText(file.parseStatus) }}</p>
              <details class="technical-details">
                <summary>文件详情</summary>
                <small>{{ file.contentType || '类型未知' }} · {{ file.storageProvider || '默认存储' }}</small>
              </details>
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
            <button class="secondary danger" type="button" :disabled="loading" @click="pendingFileDelete = file">删除</button>
          </article>
        </section>

        <section class="panel item stack retrieval-test">
          <div class="section-title">
            <div>
              <h2>检索测试</h2>
              <p class="muted">用一个问题验证 Lyle 能否从当前资料中找到答案。</p>
            </div>
            <button class="secondary" type="button" @click="showRetrievalTest = !showRetrievalTest">
              {{ showRetrievalTest ? '收起' : '打开检索测试' }}
            </button>
          </div>

          <template v-if="showRetrievalTest">
            <div class="row retrieval-question">
              <input v-model="ragQuestion" data-testid="rag-question-input" placeholder="例如：这份文档的主要结论是什么？" />
              <button data-testid="rag-debug-button" type="button" :disabled="loading" @click="runRagDebug">
                {{ loading ? '测试中' : '测试检索' }}
              </button>
            </div>

            <div v-if="ragDebug" class="retrieval-results stack">
              <div class="section-title">
                <div>
                  <h3>找到的资料</h3>
                  <p class="muted">{{ ragDebug.contexts.length ? `找到 ${ragDebug.contexts.length} 个相关片段。` : '没有找到可直接回答的资料。' }}</p>
                </div>
                <span v-if="ragDebug.citationQuality" class="badge">引用可靠性 {{ ragDebug.citationQuality.level }}</span>
              </div>
              <div v-if="ragDebug.contexts.length === 0" class="empty-state compact">
                <strong>没有找到相关内容</strong>
                <span>可以换一种问法，或确认文件已经处理完成。</span>
              </div>
              <article v-for="context in ragDebug.contexts" :key="`${context.title}-${context.chunk}`" class="source-box">
                <strong>{{ context.title }}</strong>
                <small class="memory-meta">{{ context.parentTitle || '文档内容' }}</small>
                <p>{{ context.chunk }}</p>
              </article>
            </div>

            <button class="technical-toggle" type="button" :aria-expanded="showTechnicalDetails" @click="toggleTechnicalDetails">
              {{ showTechnicalDetails ? '收起技术详情' : '查看技术详情' }}
            </button>
            <section v-if="showTechnicalDetails" class="technical-panel stack" aria-label="检索技术详情">
              <div v-if="ragDebug" class="grid">
                <article class="item"><h3>检索词</h3><p v-for="query in ragDebug.queries" :key="query" class="muted">{{ query }}</p></article>
                <article class="item"><h3>资料充分性</h3><pre>{{ JSON.stringify(ragDebug.sufficiency, null, 2) }}</pre></article>
              </div>
              <div class="stack">
                <h3>索引片段预览</h3>
                <article v-for="chunk in ragChunks" :key="`${chunk.doc_id}-${chunk.title}`" class="source-box">
                  <strong>{{ chunk.title }}</strong>
                  <small class="memory-meta">片段 #{{ chunk.chunkIndex || '-' }} · {{ chunk.backend || '默认检索服务' }}</small>
                  <p>{{ chunk.chunk }}</p>
                </article>
                <p v-if="ragChunks.length === 0" class="muted">当前没有可预览的索引片段。</p>
              </div>
            </section>
          </template>
        </section>
      </section>
    </div>

    <ConfirmActionDialog
      :open="Boolean(pendingKnowledgeBaseDelete)"
      title="删除知识库"
      :description="`删除“${pendingKnowledgeBaseDelete?.name || ''}”后，其中的文件将不再用于回答。此操作无法撤销。`"
      confirm-label="确认删除"
      danger
      :busy="loading"
      @update:open="(open) => { if (!open) pendingKnowledgeBaseDelete = null }"
      @confirm="pendingKnowledgeBaseDelete && removeKnowledgeBase(pendingKnowledgeBaseDelete.id)"
    />
    <ConfirmActionDialog
      :open="Boolean(pendingFileDelete)"
      title="删除文件"
      :description="`删除“${pendingFileDelete?.fileName || ''}”后，Lyle 将不再引用它。`"
      confirm-label="确认删除"
      danger
      :busy="loading"
      @update:open="(open) => { if (!open) pendingFileDelete = null }"
      @confirm="pendingFileDelete && removeFile(pendingFileDelete.id)"
    />
    <ConfirmActionDialog
      :open="pendingRebuildAll"
      title="重新处理全部文件"
      :description="`将重新处理“${selectedKnowledgeBase?.name || ''}”中的 ${files.length} 个文件，期间检索结果可能短暂变化。`"
      confirm-label="开始处理"
      :busy="loading"
      @update:open="pendingRebuildAll = $event"
      @confirm="rebuildAllFiles"
    />
  </section>
</template>

<style scoped>
.upload-zone {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border: 1px dashed color-mix(in srgb, var(--primary) 38%, var(--border));
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 7%, var(--surface)) 0%, var(--surface) 72%);
  padding: 16px;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}
.upload-zone.is-dragging {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 11%, var(--surface));
  transform: translateY(-1px);
}
.upload-zone.is-busy { opacity: .72; }
.upload-zone__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 13px;
  background: var(--primary-soft);
  color: var(--primary);
}
.upload-zone__copy { display: grid; gap: 3px; min-width: 0; }
.upload-zone__copy span { color: var(--muted-foreground); font-size: 13px; line-height: 1.45; }
.upload-zone__button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--primary-border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--primary);
  cursor: pointer;
  padding: 0 15px;
  font-size: 13px;
  font-weight: 750;
  box-shadow: var(--shadow-sm);
}
.upload-zone__button:hover { background: var(--primary-soft); }
.upload-zone__button.disabled { cursor: wait; opacity: .7; }
.upload-formats {
  display: flex;
  grid-column: 2 / -1;
  flex-wrap: wrap;
  gap: 7px;
}
.upload-formats span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 84%, transparent);
  color: var(--muted-foreground);
  padding: 4px 9px;
  font-size: 12px;
}
.technical-details { margin-top: 4px; color: var(--muted-foreground); font-size: 12px; }.technical-details summary { width: fit-content; cursor: pointer; }
.retrieval-question input { min-width: 0; flex: 1; }.technical-toggle { width: fit-content; border: 0; background: transparent; color: var(--muted-foreground); padding: 4px 0; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
.technical-panel { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-muted); padding: var(--space-4); }.technical-panel pre { max-height: 220px; overflow: auto; white-space: pre-wrap; }
@media (max-width: 680px) {
  .upload-zone { grid-template-columns: auto minmax(0, 1fr); }
  .upload-zone__button { grid-column: 1 / -1; width: 100%; }
  .upload-formats { grid-column: 1 / -1; }
  .retrieval-question { flex-direction: column; }
  .retrieval-question button { width: 100%; }
}
</style>
