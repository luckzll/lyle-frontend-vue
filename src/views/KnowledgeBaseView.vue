<script setup lang="ts">
import axios from 'axios'
import {
  CircleAlert,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  FileUp,
  FolderOpen,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

const name = ref('')
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
const showRetrievalTest = ref(true)
const showTechnicalDetails = ref(false)
const dragActive = ref(false)
const showCreateForm = ref(false)
const knowledgeMenuOpen = ref(false)
const openFileMenuId = ref<string>()
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
    showCreateForm.value = false
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
  showRetrievalTest.value = true
  showTechnicalDetails.value = false
  knowledgeMenuOpen.value = false
  openFileMenuId.value = undefined
  await refreshFiles()
}

function closeMenus() {
  knowledgeMenuOpen.value = false
  openFileMenuId.value = undefined
}

function toggleFileMenu(fileId: string) {
  openFileMenuId.value = openFileMenuId.value === fileId ? undefined : fileId
  knowledgeMenuOpen.value = false
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

function formatCreatedAt(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

onMounted(() => {
  void refreshKnowledgeBases()
  window.addEventListener('click', closeMenus)
})

onBeforeUnmount(() => window.removeEventListener('click', closeMenus))
</script>

<template>
  <section class="page kb-page">
    <p v-if="error" class="alert danger" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert success" role="status">{{ notice }}</p>
    <p v-if="memoryNotice" class="alert success" role="status">
      {{ memoryNotice }}
      <a class="inline-link" href="/memory">查看待确认记忆</a>
    </p>

    <div class="kb-layout">
      <aside class="kb-sidebar" aria-label="知识库列表">
        <div class="kb-sidebar__header">
          <h2>知识库</h2>
          <button
            class="icon-action"
            type="button"
            aria-label="新建知识库"
            title="新建知识库"
            @click.stop="showCreateForm = !showCreateForm"
          >
            <Plus :size="18" aria-hidden="true" />
          </button>
        </div>

        <form
          v-if="showCreateForm || (!pageLoading && knowledgeBases.length === 0)"
          class="kb-create"
          @submit.prevent="create"
        >
          <label for="knowledge-name">知识库名称</label>
          <input
            id="knowledge-name"
            v-model="name"
            data-testid="knowledge-name-input"
            placeholder="例如：产品资料"
            autofocus
          />
          <div class="kb-create__actions">
            <button
              v-if="knowledgeBases.length > 0"
              class="secondary"
              type="button"
              @click="showCreateForm = false"
            >
              取消
            </button>
            <button data-testid="create-knowledge-button" type="submit" :disabled="loading || !name.trim()">
              创建
            </button>
          </div>
        </form>

        <div v-if="pageLoading" class="empty-state compact">
          <strong>正在加载</strong>
          <span>读取知识库列表。</span>
        </div>
        <div v-else-if="knowledgeBases.length === 0" class="empty-state compact">
          <strong>暂无知识库</strong>
          <span>创建一个知识库后即可上传文件。</span>
        </div>
        <div v-else class="kb-list">
          <button
            v-for="item in knowledgeBases"
            :key="item.id"
            class="kb-list-item"
            :class="{ active: item.id === selectedKnowledgeBaseId }"
            type="button"
            @click="selectKnowledgeBase(item.id)"
          >
            <span class="kb-list-item__icon"><FolderOpen :size="18" aria-hidden="true" /></span>
            <span class="kb-list-item__copy">
              <strong>{{ item.name }}</strong>
              <small>{{ item.id === selectedKnowledgeBaseId ? `${files.length} 个文件` : '点击打开' }}</small>
            </span>
            <MoreHorizontal :size="17" aria-hidden="true" />
          </button>
        </div>

        <button class="kb-refresh" type="button" :disabled="pageLoading" @click="refreshKnowledgeBases">
          <RefreshCw :size="15" aria-hidden="true" />
          {{ pageLoading ? '正在刷新' : '刷新列表' }}
        </button>
      </aside>

      <section v-if="selectedKnowledgeBaseId" class="kb-workspace" aria-label="知识库详情">
        <header class="kb-workspace__header">
          <div>
            <div class="kb-title-row">
              <h1>{{ selectedKnowledgeBase?.name || '选择知识库' }}</h1>
              <div class="action-menu" @click.stop>
                <button
                  class="icon-action"
                  type="button"
                  :aria-expanded="knowledgeMenuOpen"
                  aria-label="知识库操作"
                  title="知识库操作"
                  @click="knowledgeMenuOpen = !knowledgeMenuOpen"
                >
                  <MoreHorizontal :size="19" aria-hidden="true" />
                </button>
                <div v-if="knowledgeMenuOpen" class="action-menu__popover" role="menu">
                  <button
                    v-if="files.length > 0"
                    type="button"
                    role="menuitem"
                    :disabled="loading"
                    @click="knowledgeMenuOpen = false; pendingRebuildAll = true"
                  >
                    <RefreshCw :size="15" aria-hidden="true" />
                    重建全部索引
                  </button>
                  <button
                    class="danger-action"
                    type="button"
                    role="menuitem"
                    :disabled="loading"
                    @click="knowledgeMenuOpen = false; pendingKnowledgeBaseDelete = selectedKnowledgeBase || null"
                  >
                    <Trash2 :size="15" aria-hidden="true" />
                    删除知识库
                  </button>
                </div>
              </div>
            </div>
            <p>{{ files.length }} 个文件 · 回答时按需引用</p>
          </div>

          <div class="kb-workspace__actions">
            <input
              id="knowledge-file-input"
              class="visually-hidden"
              type="file"
              :accept="KNOWLEDGE_FILE_ACCEPT"
              data-testid="knowledge-file-input"
              :disabled="loading"
              multiple
              @change="upload"
            />
            <label
              class="primary-upload-button"
              :class="{ disabled: loading }"
              for="knowledge-file-input"
              :aria-disabled="loading"
            >
              <FileUp :size="17" aria-hidden="true" />
              {{ loading ? '处理中…' : '添加资料' }}
            </label>
          </div>
        </header>

        <div
          class="upload-zone"
          :class="{ 'is-dragging': dragActive, 'is-busy': loading }"
          @dragenter="preventDropDefaults"
          @dragover="preventDropDefaults"
          @dragleave="leaveDropZone"
          @drop.prevent="dropFiles"
        >
          <div class="upload-zone__icon"><FileUp :size="21" aria-hidden="true" /></div>
          <div class="upload-zone__copy">
            <strong>{{ loading ? '正在解析并建立索引…' : '拖入文件到这里上传' }}</strong>
            <span>支持文本型 PDF、Word、Excel、PowerPoint 和常见文本文件，可一次选择多个。</span>
          </div>
          <label class="upload-zone__link" :class="{ disabled: loading }" for="knowledge-file-input">
            {{ loading ? '处理中' : '选择文件' }}
          </label>
        </div>

        <section class="file-section" aria-labelledby="file-section-title">
          <div class="file-section__header">
            <h2 id="file-section-title">文件</h2>
            <span>{{ files.length }} 个文件</span>
          </div>
          <div v-if="files.length === 0" class="empty-state compact">
            <strong>这个知识库还是空的</strong>
            <span>上传 PDF、DOCX、XLS/XLSX、PPTX 或文本文件后会自动入库。</span>
          </div>

          <div v-else class="file-table" role="table" aria-label="知识库文件">
            <div class="file-table__head" role="row">
              <span role="columnheader">文件名称</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">添加时间</span>
              <span role="columnheader">操作</span>
            </div>
            <article v-for="file in files" :key="file.id" class="file-row" role="row">
              <div class="file-row__main" role="cell">
                <span class="file-row__icon"><FileText :size="20" aria-hidden="true" /></span>
                <div class="file-row__copy">
                  <strong>{{ file.fileName }}</strong>
                  <p>{{ formatFileSize(file.fileSize) }}</p>
                  <details class="technical-details">
                    <summary>文件详情</summary>
                    <small>{{ file.contentType || '类型未知' }} · {{ file.storageProvider || '默认存储' }}</small>
                  </details>
                </div>
              </div>
              <span class="file-status" :class="statusClass(file.parseStatus)" role="cell">
                <CheckCircle2 v-if="file.parseStatus === 'completed'" :size="15" aria-hidden="true" />
                <Clock3 v-else-if="file.parseStatus === 'queued'" :size="15" aria-hidden="true" />
                <CircleAlert v-else :size="15" aria-hidden="true" />
                {{ statusText(file.parseStatus) }}
              </span>
              <time class="file-created-at" :datetime="file.createdAt" role="cell">
                {{ formatCreatedAt(file.createdAt) }}
              </time>
              <div class="action-menu file-action-menu" role="cell" @click.stop>
                <button
                  class="icon-action"
                  type="button"
                  :aria-expanded="openFileMenuId === file.id"
                  :aria-label="`${file.fileName} 操作`"
                  title="文件操作"
                  @click="toggleFileMenu(file.id)"
                >
                  <MoreHorizontal :size="19" aria-hidden="true" />
                </button>
                <div v-if="openFileMenuId === file.id" class="action-menu__popover" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    :disabled="loading || rebuildingFileIds.has(file.id)"
                    @click="openFileMenuId = undefined; rebuildFile(file.id)"
                  >
                    <RefreshCw :size="15" aria-hidden="true" />
                    {{ rebuildingFileIds.has(file.id) ? '重建中' : '重建索引' }}
                  </button>
                  <button
                    class="danger-action"
                    type="button"
                    role="menuitem"
                    :disabled="loading"
                    @click="openFileMenuId = undefined; pendingFileDelete = file"
                  >
                    <Trash2 :size="15" aria-hidden="true" />
                    删除文件
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section class="retrieval-test">
          <button class="retrieval-test__summary" type="button" @click="showRetrievalTest = !showRetrievalTest">
            <div>
              <h2>检索测试</h2>
              <p>用一个问题验证 Lyle 能否从当前资料中找到答案。</p>
            </div>
            <span>
              {{ showRetrievalTest ? '收起检索测试' : '打开检索测试' }}
              <ChevronUp v-if="showRetrievalTest" :size="17" aria-hidden="true" />
              <ChevronDown v-else :size="17" aria-hidden="true" />
            </span>
          </button>

          <div v-if="showRetrievalTest" class="retrieval-test__body">
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
          </div>
        </section>
      </section>

      <section v-else-if="!pageLoading" class="kb-workspace kb-workspace--empty" aria-label="知识库空状态">
        <FolderOpen :size="30" aria-hidden="true" />
        <h1>知识库</h1>
        <h2>创建第一个知识库</h2>
        <p>建立知识库后，就可以上传资料并让 Lyle 在回答时引用。</p>
        <button type="button" @click="showCreateForm = true">新建知识库</button>
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
.kb-page {
  gap: 12px;
}

.kb-layout {
  display: grid;
  min-height: calc(100dvh - var(--lyle-header-height, 68px) - 48px);
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius-xl, 12px);
  background: var(--surface, #fff);
}

.kb-sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  border-right: 1px solid var(--border, #e2e8f0);
  background: var(--surface, #fff);
  padding: 20px 16px;
}

.kb-sidebar__header,
.kb-title-row,
.kb-workspace__header,
.file-section__header,
.retrieval-test__summary,
.retrieval-test__summary > span,
.primary-upload-button,
.kb-refresh,
.file-status,
.action-menu__popover button {
  display: flex;
  align-items: center;
}

.kb-sidebar__header,
.kb-workspace__header,
.file-section__header,
.retrieval-test__summary {
  justify-content: space-between;
}

.kb-sidebar__header h2 {
  margin: 0;
  color: var(--foreground, #0f172a);
  font-size: 15px;
  font-weight: 720;
}

.icon-action {
  display: inline-grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  color: var(--muted-foreground, #64748b);
  padding: 0;
}

.icon-action:hover,
.icon-action[aria-expanded='true'] {
  border-color: var(--border, #e2e8f0);
  background: var(--surface-muted, #f8fafc);
  color: var(--foreground, #0f172a);
}

.kb-create {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  border: 1px solid var(--primary-border, #c7d2fe);
  border-radius: var(--radius-lg, 10px);
  background: var(--primary-soft, #eef2ff);
  padding: 12px;
}

.kb-create label {
  color: var(--foreground, #0f172a);
  font-size: 12px;
  font-weight: 700;
}

.kb-create input {
  min-height: 42px;
  background: var(--surface, #fff);
}

.kb-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.kb-create__actions button {
  min-height: 40px;
}

.kb-list {
  display: grid;
  gap: 6px;
}

.kb-list-item {
  display: grid;
  width: 100%;
  min-height: 66px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--radius-lg, 10px);
  background: transparent;
  color: var(--foreground, #0f172a);
  padding: 10px 11px;
  text-align: left;
}

.kb-list-item:hover {
  background: var(--surface-muted, #f8fafc);
}

.kb-list-item.active {
  border-color: transparent;
  background: var(--primary-soft, #eef2ff);
  color: var(--primary, #4f46e5);
}

.kb-list-item__icon {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--primary, #4f46e5) 8%, var(--surface, #fff));
  color: var(--primary, #4f46e5);
}

.kb-list-item__copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.kb-list-item__copy strong,
.kb-list-item__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-list-item__copy strong {
  font-size: 14px;
}

.kb-list-item__copy small {
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
  font-weight: 500;
}

.kb-refresh {
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  margin-top: auto;
  border: 0;
  background: transparent;
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
}

.kb-refresh:hover {
  background: var(--surface-muted, #f8fafc);
  color: var(--foreground, #0f172a);
}

.kb-workspace {
  display: flex;
  min-width: 0;
  min-height: 680px;
  flex-direction: column;
  background: var(--surface, #fff);
  padding: 32px 32px 28px;
}

.kb-workspace__header {
  gap: 24px;
  margin-bottom: 26px;
}

.kb-title-row {
  gap: 8px;
}

.kb-title-row h1 {
  margin: 0;
  color: var(--foreground, #0f172a);
  font-size: clamp(24px, 2.2vw, 30px);
  font-weight: 740;
  letter-spacing: -0.035em;
}

.kb-workspace__header p {
  margin: 7px 0 0;
  color: var(--muted-foreground, #64748b);
  font-size: 14px;
}

.kb-workspace__actions {
  flex: 0 0 auto;
}

.primary-upload-button {
  min-height: 42px;
  justify-content: center;
  gap: 8px;
  border-radius: var(--radius-md, 8px);
  background: var(--primary, #4f46e5);
  color: var(--primary-foreground, #fff);
  cursor: pointer;
  padding: 0 17px;
  font-size: 14px;
  font-weight: 720;
  transition: background 160ms ease, transform 160ms ease;
}

.primary-upload-button:hover {
  background: #4338ca;
}

.primary-upload-button:active {
  transform: translateY(1px);
}

.primary-upload-button.disabled,
.upload-zone__link.disabled {
  cursor: wait;
  opacity: .6;
  pointer-events: none;
}

.visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  overflow: hidden !important;
  clip: rect(0 0 0 0) !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
}

.action-menu {
  position: relative;
}

.action-menu__popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: grid;
  width: 190px;
  gap: 2px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  background: var(--surface, #fff);
  padding: 6px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, .12);
}

.action-menu__popover button {
  width: 100%;
  min-height: 40px;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--foreground, #0f172a);
  padding: 0 10px;
  text-align: left;
}

.action-menu__popover button:hover {
  background: var(--surface-muted, #f8fafc);
}

.action-menu__popover .danger-action {
  color: var(--danger-strong, #dc2626);
}

.upload-zone {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  border: 1px dashed var(--primary-border, #c7d2fe);
  border-radius: var(--radius-lg, 10px);
  background: color-mix(in srgb, var(--primary-soft, #eef2ff) 32%, var(--surface, #fff));
  min-height: 112px;
  padding: 22px 24px;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.upload-zone.is-dragging {
  border-color: var(--primary, #4f46e5);
  background: var(--primary-soft, #eef2ff);
  transform: translateY(-1px);
}

.upload-zone.is-busy { opacity: .72; }

.upload-zone__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: var(--radius-lg, 10px);
  background: var(--primary-soft, #eef2ff);
  color: var(--primary, #4f46e5);
}

.upload-zone__copy { display: grid; gap: 3px; min-width: 0; }

.upload-zone__copy strong {
  color: var(--foreground, #0f172a);
  font-size: 14px;
}

.upload-zone__copy span {
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
  line-height: 1.5;
}

.upload-zone__link {
  min-height: 40px;
  cursor: pointer;
  color: var(--primary, #4f46e5);
  padding: 10px 4px;
  font-size: 13px;
  font-weight: 720;
}

.file-section {
  margin-top: 26px;
}

.file-section__header {
  min-height: 40px;
  gap: 12px;
  margin-bottom: 6px;
}

.file-section__header h2 {
  margin: 0;
  color: var(--foreground, #0f172a);
  font-size: 18px;
  font-weight: 700;
}

.file-section__header span {
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
}

.file-table {
  min-width: 0;
}

.file-table__head,
.file-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 110px 120px 40px;
  column-gap: 12px;
  align-items: center;
}

.file-table__head {
  min-height: 42px;
  border-top: 1px solid var(--border, #e2e8f0);
  border-bottom: 1px solid var(--border, #e2e8f0);
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
  font-weight: 650;
}

.file-table__head span:last-child {
  text-align: center;
}

.file-row {
  min-height: 78px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  padding: 12px 0;
}

.file-row:hover {
  background: color-mix(in srgb, var(--surface-muted, #f8fafc) 70%, transparent);
}

.file-row__main {
  display: grid;
  min-width: 0;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.file-row__icon {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: var(--radius-md, 8px);
  background: var(--primary-soft, #eef2ff);
  color: var(--primary, #4f46e5);
}

.file-row__copy {
  min-width: 0;
}

.file-row__copy > strong {
  display: block;
  overflow: hidden;
  color: var(--foreground, #0f172a);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row__copy > p {
  margin: 5px 0 0;
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
}

.file-status {
  gap: 5px;
  color: var(--muted-foreground, #64748b);
  font-size: 13px;
  font-weight: 650;
}

.file-status.success { color: var(--success-strong, #047857); }
.file-status.pending { color: var(--warning-strong, #b45309); }
.file-status.danger { color: var(--danger-strong, #dc2626); }

.file-created-at {
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
}

.file-action-menu .action-menu__popover {
  top: calc(100% - 2px);
}

.technical-details {
  margin-top: 5px;
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
}

.technical-details summary {
  width: fit-content;
  cursor: pointer;
}

.retrieval-test {
  margin-top: auto;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  background: var(--surface, #fff);
}

.retrieval-test__summary {
  width: 100%;
  min-height: 86px;
  gap: 20px;
  border: 0;
  background: transparent;
  color: var(--foreground, #0f172a);
  padding: 18px 20px;
  text-align: left;
}

.retrieval-test__summary:hover {
  background: var(--surface-muted, #f8fafc);
}

.retrieval-test__summary h2,
.retrieval-test__summary p {
  margin: 0;
}

.retrieval-test__summary h2 {
  font-size: 16px;
}

.retrieval-test__summary p {
  margin-top: 6px;
  color: var(--muted-foreground, #64748b);
  font-size: 13px;
  line-height: 1.5;
}

.retrieval-test__summary > span {
  flex: 0 0 auto;
  gap: 7px;
  color: var(--muted-foreground, #64748b);
  font-size: 13px;
  font-weight: 650;
}

.retrieval-test__body {
  display: grid;
  gap: 14px;
  border-top: 1px solid var(--border, #e2e8f0);
  padding: 18px 20px 20px;
}

.retrieval-question input {
  min-width: 0;
  flex: 1;
}

.technical-toggle {
  width: fit-content;
  border: 0;
  background: transparent;
  color: var(--muted-foreground, #64748b);
  padding: 4px 0;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.technical-panel {
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  background: var(--surface-muted, #f8fafc);
  padding: var(--space-4, 16px);
}

.technical-panel pre {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
}

.kb-workspace--empty {
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground, #64748b);
  text-align: center;
}

.kb-workspace--empty h1 {
  margin: 16px 0 0;
  color: var(--foreground, #0f172a);
  font-size: 24px;
}

.kb-workspace--empty h2 {
  margin: 8px 0 0;
  color: var(--foreground, #0f172a);
  font-size: 18px;
}

.kb-workspace--empty p {
  max-width: 420px;
  margin: 8px 0 18px;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .kb-layout {
    grid-template-columns: minmax(190px, 220px) minmax(0, 1fr);
  }

  .kb-workspace {
    padding: 28px 24px 24px;
  }
}

@media (max-width: 760px) {
  .kb-layout {
    min-height: auto;
    grid-template-columns: 1fr;
  }

  .kb-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }

  .kb-list {
    grid-auto-flow: column;
    grid-auto-columns: minmax(190px, 1fr);
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .kb-refresh {
    display: none;
  }

  .kb-workspace {
    min-height: 620px;
  }
}

@media (max-width: 680px) {
  .kb-workspace {
    min-height: 560px;
    padding: 22px 16px 16px;
  }

  .kb-workspace__header {
    align-items: stretch;
    flex-direction: column;
  }

  .primary-upload-button {
    width: 100%;
  }

  .upload-zone {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 16px;
  }

  .upload-zone__link {
    grid-column: 1 / -1;
    justify-self: stretch;
    border-top: 1px solid var(--border, #e2e8f0);
    padding: 12px 0 0;
    text-align: center;
  }

  .file-table__head {
    display: none;
  }

  .file-row {
    grid-template-columns: minmax(0, 1fr) 40px;
    row-gap: 6px;
  }

  .file-status {
    grid-column: 1;
    padding-left: 52px;
  }

  .file-action-menu {
    grid-column: 2;
    grid-row: 1;
  }

  .file-created-at {
    display: none;
  }

  .retrieval-test {
    margin-top: 28px;
  }

  .retrieval-test__summary {
    min-height: 96px;
  }

  .retrieval-test__summary > span {
    font-size: 0;
  }

  .retrieval-question {
    flex-direction: column;
  }

  .retrieval-question button {
    width: 100%;
    min-height: 44px;
  }
}
</style>
