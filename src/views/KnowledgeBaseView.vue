<script setup lang="ts">
import axios from 'axios'
import {
  ArrowRight,
  CircleAlert,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  FileText,
  FileUp,
  FolderOpen,
  LibraryBig,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
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
  updateKnowledgeBase,
  uploadKnowledgeFile
} from '@/api/app'
import type { KnowledgeBase, KnowledgeFile, RagChunkResponse, RagDebugResponse } from '@/api/types'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import DetailDrawer from '@/components/layout/DetailDrawer.vue'
import AppButton from '@/components/ui/AppButton.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import { isKnowledgeFileSupported, KNOWLEDGE_FILE_ACCEPT } from '@/domain/knowledge-file'

const name = ref('')
const router = useRouter()
const loading = ref(false)
const uploading = ref(false)
const querying = ref(false)
const pageLoading = ref(true)
const listLoaded = ref(false)
const listError = ref('')
const filesLoading = ref(false)
const filesError = ref('')
const knowledgeSearch = ref('')
let active = true
let listRequest = 0
let fileRequest = 0
let chunkRequest = 0
let viewGeneration = 0
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
const confirmationError = ref('')
const showRetrievalTest = ref(false)
const showTechnicalDetails = ref(false)
const dragActive = ref(false)
const showCreateForm = ref(false)
const knowledgeNameInput = ref<HTMLInputElement | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const createError = ref('')
let createFormTrigger: HTMLElement | null = null
const knowledgeMenuOpen = ref(false)
const openFileMenuId = ref<string>()
const renamingKnowledgeBase = ref(false)
const renameDraft = ref('')
const renameSaving = ref(false)
const selectedKnowledgeBase = computed(() =>
  knowledgeBases.value.find((item) => item.id === selectedKnowledgeBaseId.value)
)
const isEmpty = computed(() => listLoaded.value && !listError.value && !knowledgeBases.value.length)
const visibleKnowledgeBases = computed(() => knowledgeBases.value.filter((item) => item.name.toLocaleLowerCase().includes(knowledgeSearch.value.trim().toLocaleLowerCase())))
const readyFiles = computed(() => files.value.filter((file) => file.parseStatus === 'completed'))
const busy = computed(() => loading.value || renameSaving.value || rebuildingFileIds.value.size > 0)
const hasEmptyFiles = computed(() => !filesLoading.value && !filesError.value && !files.value.length)

function currentView(id: string, generation: number) {
  return active && selectedKnowledgeBaseId.value === id && viewGeneration === generation
}

async function refreshKnowledgeBases() {
  const request = ++listRequest
  pageLoading.value = true
  listError.value = ''
  try {
    const response = await listKnowledgeBases()
    if (!active || request !== listRequest) return
    knowledgeBases.value = response.data
    listLoaded.value = true
    if (!response.data.some((item) => item.id === selectedKnowledgeBaseId.value)) {
      await selectKnowledgeBase(response.data[0]?.id)
    } else {
      await refreshFiles()
    }
  } catch {
    if (active && request === listRequest) listError.value = '知识库列表加载失败，请稍后重试。'
  } finally {
    if (active && request === listRequest) pageLoading.value = false
  }
}

async function openCreateForm(event?: Event) {
  if (busy.value) return
  createFormTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement as HTMLElement | null
  showCreateForm.value = true
  createError.value = ''
  notice.value = ''
  await nextTick()
  await nextTick()
  knowledgeNameInput.value?.focus({ preventScroll: true })
  knowledgeNameInput.value?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

async function cancelCreate() {
  if (loading.value) return
  showCreateForm.value = false
  createError.value = ''
  await nextTick()
  if (createFormTrigger?.isConnected) createFormTrigger.focus()
}

async function create() {
  if (busy.value || !name.value.trim()) return
  const needsListReload = !listLoaded.value || Boolean(listError.value)
  loading.value = true
  createError.value = ''
  error.value = ''
  notice.value = ''
  try {
    const response = await createKnowledgeBase(name.value.trim())
    if (!active) return
    listRequest += 1
    pageLoading.value = false
    knowledgeBases.value = [response.data, ...knowledgeBases.value.filter((item) => item.id !== response.data.id)]
    knowledgeSearch.value = ''
    name.value = ''
    showCreateForm.value = false
    notice.value = '知识库已创建。'
    await selectKnowledgeBase(response.data.id)
    if (active && needsListReload) await refreshKnowledgeBases()
  } catch {
    if (active) createError.value = '知识库创建失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function refreshFiles(id = selectedKnowledgeBaseId.value, generation = viewGeneration) {
  if (!id || !currentView(id, generation)) return
  const request = ++fileRequest
  filesLoading.value = true
  try {
    const response = await listKnowledgeFiles(id)
    if (!currentView(id, generation) || request !== fileRequest) return
    files.value = response.data
    filesError.value = ''
  } catch {
    if (currentView(id, generation) && request === fileRequest) filesError.value = '文件列表加载失败，请重试。'
  } finally {
    if (currentView(id, generation) && request === fileRequest) filesLoading.value = false
  }
}

async function removeKnowledgeBase(id: string) {
  if (busy.value) return
  loading.value = true
  error.value = ''
  confirmationError.value = ''
  notice.value = ''
  try {
    await deleteKnowledgeBase(id)
    if (!active) return
    knowledgeBases.value = knowledgeBases.value.filter((item) => item.id !== id)
    if (selectedKnowledgeBaseId.value === id) {
      await selectKnowledgeBase(knowledgeBases.value[0]?.id)
    }
    notice.value = '知识库已删除。'
    pendingKnowledgeBaseDelete.value = null
    await refreshKnowledgeBases()
  } catch {
    if (active) confirmationError.value = '知识库删除失败，请重试。'
  } finally {
    loading.value = false
  }
}

async function startRenameKnowledgeBase() {
  if (!selectedKnowledgeBase.value || busy.value) return
  renameDraft.value = selectedKnowledgeBase.value.name
  renamingKnowledgeBase.value = true
  knowledgeMenuOpen.value = false
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function cancelRenameKnowledgeBase() {
  renamingKnowledgeBase.value = false
  renameDraft.value = ''
}

async function renameKnowledgeBase() {
  const id = selectedKnowledgeBaseId.value
  const nextName = renameDraft.value.trim()
  const generation = viewGeneration
  if (!id || !nextName || busy.value) return
  if (nextName === selectedKnowledgeBase.value?.name) {
    cancelRenameKnowledgeBase()
    return
  }

  renameSaving.value = true
  error.value = ''
  notice.value = ''
  try {
    const response = await updateKnowledgeBase(id, nextName)
    if (!active) return
    listRequest += 1
    pageLoading.value = false
    knowledgeBases.value = knowledgeBases.value.map((item) => item.id === id ? response.data : item)
    if (!currentView(id, generation)) return
    notice.value = '知识库名称已更新。'
    cancelRenameKnowledgeBase()
  } catch {
    if (currentView(id, generation)) error.value = '知识库重命名失败，请稍后重试。'
  } finally {
    renameSaving.value = false
  }
}

async function openChatWithKnowledgeBase() {
  if (!selectedKnowledgeBaseId.value) return
  await router.push({ name: 'chat', query: { knowledgeBaseId: selectedKnowledgeBaseId.value } })
}

async function removeFile(fileId: string) {
  const id = selectedKnowledgeBaseId.value
  const generation = viewGeneration
  if (!id || busy.value) return
  loading.value = true
  error.value = ''
  confirmationError.value = ''
  notice.value = ''
  try {
    await deleteKnowledgeFile(id, fileId)
    if (!currentView(id, generation)) return
    notice.value = '文件已删除。'
    pendingFileDelete.value = null
    await refreshFiles(id, generation)
  } catch {
    if (currentView(id, generation)) confirmationError.value = '文件删除失败，请重试。'
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
  const id = selectedKnowledgeBaseId.value
  const generation = viewGeneration
  if (!selectedFiles.length || !id || busy.value) return

  const unsupported = selectedFiles.filter((file) => !isKnowledgeFileSupported(file.name))
  if (unsupported.length) {
    error.value = `暂不支持：${unsupported.map((file) => file.name).join('、')}。请上传 PDF、DOCX、XLS/XLSX、PPTX 或文本文件。`
    return
  }

  loading.value = true
  uploading.value = true
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  let completed = 0
  let readyCount = 0
  let candidateMemoryCount = 0
  const failures: string[] = []
  for (const file of selectedFiles) {
    try {
      const response = await uploadKnowledgeFile(id, file)
      completed += 1
      if (response.data.parseStatus === 'completed') readyCount += 1
      candidateMemoryCount += response.data.candidateMemories?.length || 0
    } catch (exception) {
      failures.push(`${file.name}：${uploadFailureMessage(exception)}`)
    }
  }
  if (!currentView(id, generation)) { loading.value = false; uploading.value = false; return }
  if (completed) {
    notice.value = readyCount === completed
      ? completed === 1 ? '文件已上传并完成入库。' : `${completed} 个文件已上传并完成入库。`
      : completed === 1 ? '文件已上传，请留意处理状态。' : `${completed} 个文件已上传，请留意处理状态。`
    setMemoryNotice(candidateMemoryCount)
    await refreshFiles(id, generation)
  }
  if (failures.length && currentView(id, generation)) {
    error.value = failures.join('；')
  }
  loading.value = false
  uploading.value = false
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
  if (!busy.value) dragActive.value = true
}

async function rebuildFile(fileId: string) {
  const id = selectedKnowledgeBaseId.value
  const generation = viewGeneration
  if (!id || busy.value) return
  const next = new Set(rebuildingFileIds.value)
  next.add(fileId)
  rebuildingFileIds.value = next
  error.value = ''
  notice.value = ''
  memoryNotice.value = ''
  try {
    const response = await rebuildKnowledgeFile(id, fileId)
    if (!currentView(id, generation)) return
    notice.value = '文件索引已重建。'
    setMemoryNotice(response.data.candidateMemories?.length || 0)
    await refreshFiles(id, generation)
  } catch {
    if (currentView(id, generation)) error.value = '文件索引重建失败。'
  } finally {
    const remaining = new Set(rebuildingFileIds.value)
    remaining.delete(fileId)
    rebuildingFileIds.value = remaining
  }
}

async function rebuildAllFiles() {
  const id = selectedKnowledgeBaseId.value
  const generation = viewGeneration
  if (!id || busy.value || files.value.length === 0) return
  loading.value = true
  error.value = ''
  confirmationError.value = ''
  notice.value = ''
  memoryNotice.value = ''
  try {
    const response = await rebuildKnowledgeBaseFiles(id)
    if (!currentView(id, generation)) return
    notice.value = '知识库索引已重建。'
    const count = response.data.reduce((total, item) => total + (item.candidateMemories?.length || 0), 0)
    setMemoryNotice(count)
    pendingRebuildAll.value = false
    await refreshFiles(id, generation)
  } catch {
    if (currentView(id, generation)) confirmationError.value = '文件重新处理失败，请重试。'
  } finally {
    loading.value = false
  }
}

async function runRagDebug() {
  const id = selectedKnowledgeBaseId.value
  const generation = viewGeneration
  if (!id || busy.value || !ragQuestion.value.trim()) return
  loading.value = true
  querying.value = true
  error.value = ''
  try {
    const response = await debugRag(ragQuestion.value.trim(), [id])
    if (currentView(id, generation)) ragDebug.value = response.data
  } catch {
    if (currentView(id, generation)) error.value = '检索测试失败，请稍后重试。'
  } finally {
    loading.value = false
    querying.value = false
  }
}

async function refreshChunks() {
  const id = selectedKnowledgeBaseId.value
  const generation = viewGeneration
  const request = ++chunkRequest
  if (!id) return
  try {
    const response = await listRagChunks(id, 20)
    if (currentView(id, generation) && request === chunkRequest) ragChunks.value = response.data.items
  } catch {
    if (currentView(id, generation) && request === chunkRequest) error.value = '技术检索详情暂时无法加载。'
  }
}

async function toggleTechnicalDetails() {
  showTechnicalDetails.value = !showTechnicalDetails.value
  if (showTechnicalDetails.value && ragChunks.value.length === 0) {
    await refreshChunks()
  }
}

async function selectKnowledgeBase(id?: string) {
  viewGeneration += 1
  selectedKnowledgeBaseId.value = id
  files.value = []
  filesLoading.value = Boolean(id)
  filesError.value = ''
  error.value = ''
  memoryNotice.value = ''
  pendingFileDelete.value = null
  pendingRebuildAll.value = false
  confirmationError.value = ''
  cancelRenameKnowledgeBase()
  ragDebug.value = null
  ragChunks.value = []
  showRetrievalTest.value = false
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

onBeforeUnmount(() => {
  active = false
  viewGeneration += 1
  window.removeEventListener('click', closeMenus)
})
</script>

<template>
  <section class="page kb-page" :class="{ 'kb-page--empty': isEmpty }">
    <header class="kb-page-header">
      <div :class="{ 'visually-hidden': isEmpty }"><h1>知识库</h1><p>把常用资料整理好，让每次回答都有依据。</p></div>
      <div class="kb-page-actions">
        <AppButton variant="ghost" :loading="pageLoading" :disabled="busy" @click="refreshKnowledgeBases"><RefreshCw v-if="!pageLoading" :size="16" aria-hidden="true" />刷新</AppButton>
        <AppButton v-if="!isEmpty" :disabled="busy" aria-controls="knowledge-create-form" :aria-expanded="showCreateForm" @click="openCreateForm"><Plus :size="17" aria-hidden="true" />新建知识库</AppButton>
      </div>
    </header>
    <p v-if="error" class="alert danger" role="alert">{{ error }}</p>
    <p v-if="notice" class="kb-notice" role="status"><CheckCircle2 :size="16" aria-hidden="true" />{{ notice }}</p>
    <p v-if="memoryNotice" class="alert success" role="status">
      {{ memoryNotice }}
      <a class="inline-link" href="/memory">查看待确认记忆</a>
    </p>

    <LoadingState v-if="!listLoaded && pageLoading" label="正在加载知识库" :cards="1" />
    <ErrorState v-else-if="listError && !knowledgeBases.length" title="知识库暂时无法加载" :message="listError" :retrying="pageLoading" @retry="refreshKnowledgeBases" />
    <template v-else-if="isEmpty">
      <section class="kb-welcome" aria-label="知识库空状态">
        <span class="welcome-icon"><LibraryBig :size="38" :stroke-width="1.6" aria-hidden="true" /></span>
        <h2 id="kb-welcome-title"><span>把你的资料，</span><span>变成回答的依据</span></h2>
        <p>收集文档、笔记和常用资料，<br class="desktop-break" />让 Lyle 带着你的知识回答问题。</p>
        <div class="welcome-actions">
          <AppButton class="welcome-primary" :disabled="busy" aria-controls="knowledge-create-form" :aria-expanded="showCreateForm" @click="openCreateForm"><Plus :size="19" aria-hidden="true" />新建知识库</AppButton>
          <RouterLink class="text-action" to="/">先和 Lyle 聊聊<ArrowRight :size="17" aria-hidden="true" /></RouterLink>
        </div>
      </section>
      <section class="kb-capabilities" aria-label="知识库可以帮你做什么">
        <article><span class="capability-icon"><FileUp :size="23" aria-hidden="true" /></span><div><h3>集中整理资料</h3><p>上传文档和笔记，把同一主题的资料放在一起。</p></div></article>
        <article><span class="capability-icon"><Search :size="23" aria-hidden="true" /></span><div><h3>找到相关内容</h3><p>用一个问题，从资料中找出有用的信息。</p></div></article>
        <article><span class="capability-icon"><MessageSquareText :size="23" aria-hidden="true" /></span><div><h3>带着资料对话</h3><p>在聊天中引用知识库，让回答贴近你的背景。</p></div></article>
      </section>
    </template>
    <div v-else class="kb-layout">
      <aside class="kb-sidebar" aria-label="知识库列表">
        <div class="kb-sidebar__header">
          <h2>我的知识库</h2><span class="kb-count">{{ knowledgeBases.length }}</span>
        </div>
        <p v-if="listError" class="kb-inline-error" role="alert">{{ listError }}</p>
        <label class="kb-search"><Search :size="16" aria-hidden="true" /><input v-model="knowledgeSearch" type="search" aria-label="搜索知识库" placeholder="搜索知识库" /></label>
        <div class="kb-list">
          <button
            v-for="item in visibleKnowledgeBases"
            :key="item.id"
            class="kb-list-item"
            :class="{ active: item.id === selectedKnowledgeBaseId }"
            type="button"
            :aria-pressed="item.id === selectedKnowledgeBaseId"
            :disabled="busy"
            @click="selectKnowledgeBase(item.id)"
          >
            <span class="kb-list-item__icon"><FolderOpen :size="18" aria-hidden="true" /></span>
            <span class="kb-list-item__copy">
              <strong>{{ item.name }}</strong>
              <small>{{ item.id === selectedKnowledgeBaseId ? (filesLoading ? '正在加载资料' : filesError ? '资料暂未加载' : `${files.length} 个文件`) : '查看资料' }}</small>
            </span>
            <ChevronRight :size="17" aria-hidden="true" />
          </button>
        </div>
        <div v-if="!visibleKnowledgeBases.length" class="kb-filter-empty"><strong>没有匹配的知识库</strong><button class="text-action" type="button" @click="knowledgeSearch = ''">清除搜索</button></div>
      </aside>

      <section v-if="selectedKnowledgeBase" class="kb-workspace" aria-label="知识库详情">
        <header class="kb-workspace__header">
          <div>
            <form v-if="renamingKnowledgeBase" class="kb-title-edit" @submit.prevent="renameKnowledgeBase">
              <label class="visually-hidden" for="knowledge-rename">知识库名称</label>
              <input
                id="knowledge-rename"
                ref="renameInput"
                v-model="renameDraft"
                data-testid="knowledge-rename-input"
                maxlength="255"
                autofocus
                @keydown.esc.prevent="cancelRenameKnowledgeBase"
              />
              <button type="submit" :disabled="renameSaving || !renameDraft.trim()">
                {{ renameSaving ? '保存中…' : '保存' }}
              </button>
              <button class="secondary" type="button" :disabled="renameSaving" @click="cancelRenameKnowledgeBase">取消</button>
            </form>
            <div v-else class="kb-title-row">
              <h2>{{ selectedKnowledgeBase.name }}</h2>
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
                  <button type="button" role="menuitem" :disabled="busy" @click="startRenameKnowledgeBase">
                    <Pencil :size="15" aria-hidden="true" />
                    重命名
                  </button>
                  <button
                    v-if="files.length > 0"
                    type="button"
                    role="menuitem"
                    :disabled="busy || filesLoading || Boolean(filesError)"
                    @click="knowledgeMenuOpen = false; error = ''; confirmationError = ''; pendingRebuildAll = true"
                  >
                    <RefreshCw :size="15" aria-hidden="true" />
                    重建全部索引
                  </button>
                  <button
                    class="danger-action"
                    type="button"
                    role="menuitem"
                    :disabled="busy"
                    @click="knowledgeMenuOpen = false; error = ''; confirmationError = ''; pendingKnowledgeBaseDelete = selectedKnowledgeBase || null"
                  >
                    <Trash2 :size="15" aria-hidden="true" />
                    删除知识库
                  </button>
                </div>
              </div>
            </div>
            <p>{{ filesLoading ? '正在加载资料…' : filesError ? '资料列表暂未加载' : `${files.length} 个文件 · ${readyFiles.length} 个已就绪` }}</p>
          </div>

          <div class="kb-workspace__actions">
            <button
              v-if="readyFiles.length > 0 && !filesLoading && !filesError"
              class="secondary use-in-chat-button"
              type="button"
              @click="openChatWithKnowledgeBase"
            >
              <MessageSquareText :size="17" aria-hidden="true" />
              去聊天使用
            </button>
            <input
              id="knowledge-file-input"
              ref="fileInput"
              class="visually-hidden"
              type="file"
              :accept="KNOWLEDGE_FILE_ACCEPT"
              data-testid="knowledge-file-input"
              :disabled="busy"
              multiple
              @change="upload"
            />
            <button
              v-if="!hasEmptyFiles"
              class="primary-upload-button"
              type="button"
              :disabled="busy"
              @click="fileInput?.click()"
            >
              <FileUp :size="17" aria-hidden="true" />
              {{ loading ? '处理中…' : '添加资料' }}
            </button>
          </div>
        </header>

        <div
          class="upload-zone"
          :class="{ 'is-dragging': dragActive, 'is-busy': busy, 'upload-zone--empty': hasEmptyFiles }"
          v-if="!filesLoading && !filesError"
          @dragenter="preventDropDefaults"
          @dragover="preventDropDefaults"
          @dragleave="leaveDropZone"
          @drop.prevent="dropFiles"
        >
          <div class="upload-zone__icon"><FileUp :size="21" aria-hidden="true" /></div>
          <div class="upload-zone__copy">
            <strong>{{ uploading ? '正在上传并处理资料…' : hasEmptyFiles ? '从第一份资料开始' : '拖入文件，添加更多资料' }}</strong>
            <span>{{ hasEmptyFiles ? '把文档放进来，让 Lyle 在回答时找到相关内容。' : '支持 PDF、Word、Excel、PowerPoint 和文本文件。' }}</span>
            <small v-if="hasEmptyFiles">支持文本型 PDF、DOCX、XLS/XLSX、PPTX 和文本文件，可多选。</small>
          </div>
          <AppButton v-if="hasEmptyFiles" :disabled="busy" @click="fileInput?.click()"><FileUp :size="17" aria-hidden="true" />{{ uploading ? '上传中…' : '选择文件' }}</AppButton>
        </div>

        <LoadingState v-if="filesLoading" label="正在加载资料" :cards="1" />
        <ErrorState v-else-if="filesError" title="资料暂时无法加载" :message="filesError" @retry="refreshFiles()" />
        <section v-else-if="files.length" class="file-section" aria-labelledby="file-section-title">
          <div class="file-section__header">
            <h2 id="file-section-title">文件</h2>
            <span>{{ files.length }} 个文件</span>
          </div>
          <div class="file-table" role="table" aria-label="知识库文件">
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
                    :disabled="busy"
                    @click="openFileMenuId = undefined; rebuildFile(file.id)"
                  >
                    <RefreshCw :size="15" aria-hidden="true" />
                    {{ rebuildingFileIds.has(file.id) ? '重建中' : '重建索引' }}
                  </button>
                  <button
                    class="danger-action"
                    type="button"
                    role="menuitem"
                    :disabled="busy"
                    @click="openFileMenuId = undefined; error = ''; confirmationError = ''; pendingFileDelete = file"
                  >
                    <Trash2 :size="15" aria-hidden="true" />
                    删除文件
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-if="files.length && !filesLoading && !filesError" class="retrieval-test">
          <button class="retrieval-test__summary" type="button" :aria-expanded="showRetrievalTest" @click="showRetrievalTest = !showRetrievalTest">
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
              <input v-model="ragQuestion" aria-label="检索问题" data-testid="rag-question-input" placeholder="例如：这份文档的主要结论是什么？" />
              <button data-testid="rag-debug-button" type="button" :disabled="busy || !ragQuestion.trim()" @click="runRagDebug">
                {{ querying ? '测试中' : '测试检索' }}
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

    </div>

    <DetailDrawer v-if="showCreateForm" :open="showCreateForm" title="新建知识库" description="为一组相关资料取个名字，接着就能上传文件。" @update:open="(open) => { if (!open) cancelCreate() }">
      <form id="knowledge-create-form" class="kb-create" :aria-busy="loading" @submit.prevent="create" @keydown.esc.prevent="cancelCreate">
        <label for="knowledge-name">知识库名称</label>
        <input id="knowledge-name" ref="knowledgeNameInput" v-model="name" data-testid="knowledge-name-input" placeholder="例如：产品资料" maxlength="255" :aria-describedby="createError ? 'knowledge-create-hint knowledge-create-error' : 'knowledge-create-hint'" :disabled="loading" />
        <p id="knowledge-create-hint" class="kb-create__hint">按主题整理，例如产品资料、学习笔记或工作手册。</p>
        <p v-if="createError" id="knowledge-create-error" class="kb-create__error" role="alert">{{ createError }}</p>
        <div class="kb-create__actions"><AppButton variant="secondary" :disabled="loading" @click="cancelCreate">取消</AppButton><AppButton data-testid="create-knowledge-button" type="submit" :disabled="loading || !name.trim()">{{ loading ? '创建中…' : '创建' }}</AppButton></div>
      </form>
    </DetailDrawer>

    <ConfirmActionDialog
      :open="Boolean(pendingKnowledgeBaseDelete)"
      title="删除知识库"
      :description="`删除“${pendingKnowledgeBaseDelete?.name || ''}”后，其中的文件将不再用于回答。此操作无法撤销。`"
      confirm-label="确认删除"
      danger
      :busy="loading"
      @update:open="(open) => { if (!open) { pendingKnowledgeBaseDelete = null; confirmationError = '' } }"
      @confirm="pendingKnowledgeBaseDelete && removeKnowledgeBase(pendingKnowledgeBaseDelete.id)"
    ><template v-if="confirmationError" #default><p class="kb-confirm-error" role="alert">{{ confirmationError }}</p></template></ConfirmActionDialog>
    <ConfirmActionDialog
      :open="Boolean(pendingFileDelete)"
      title="删除文件"
      :description="`删除“${pendingFileDelete?.fileName || ''}”后，Lyle 将不再引用它。`"
      confirm-label="确认删除"
      danger
      :busy="loading"
      @update:open="(open) => { if (!open) { pendingFileDelete = null; confirmationError = '' } }"
      @confirm="pendingFileDelete && removeFile(pendingFileDelete.id)"
    ><template v-if="confirmationError" #default><p class="kb-confirm-error" role="alert">{{ confirmationError }}</p></template></ConfirmActionDialog>
    <ConfirmActionDialog
      :open="pendingRebuildAll"
      title="重新处理全部文件"
      :description="`将重新处理“${selectedKnowledgeBase?.name || ''}”中的 ${files.length} 个文件，期间检索结果可能短暂变化。`"
      confirm-label="开始处理"
      :busy="loading"
      @update:open="(open) => { pendingRebuildAll = open; if (!open) confirmationError = '' }"
      @confirm="rebuildAllFiles"
    ><template v-if="confirmationError" #default><p class="kb-confirm-error" role="alert">{{ confirmationError }}</p></template></ConfirmActionDialog>
  </section>
</template>

<style scoped>
.kb-page {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  gap: 24px;
}
.kb-page--empty { gap: 0; }
.kb-page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 52px; }
.kb-page-header h1 { margin: 0; font-size: 28px; line-height: 1.4; font-weight: 750; letter-spacing: -.035em; }
.kb-page-header p { margin: 7px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.6; }
.kb-page-actions { display: flex; flex-shrink: 0; align-items: center; gap: 10px; margin-left: auto; }
.kb-notice { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--success-strong); font-size: 14px; }
.kb-welcome { display: flex; flex-direction: column; align-items: center; padding: 48px 20px 56px; text-align: center; }
.welcome-icon { display: grid; place-items: center; width: 78px; height: 78px; margin-bottom: 25px; border-radius: 20px; background: var(--primary-soft); color: var(--primary); }
.kb-welcome h2 { margin: 0; color: var(--foreground); font-size: 34px; line-height: 1.4; font-weight: 750; letter-spacing: -.035em; }
.kb-welcome h2 span { display: inline-block; }
.kb-welcome > p { margin: 15px 0 0; color: var(--muted-foreground); font-size: 17px; line-height: 1.75; }
.welcome-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 24px; margin-top: 29px; }
.welcome-primary { min-height: 50px; padding: 12px 22px; border-radius: 10px; font-size: 16px; }
.text-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: fit-content; border: 0; background: transparent; padding: 6px 0; color: var(--primary); font-size: 14px; font-weight: 650; text-decoration: none; }
.text-action:hover { color: var(--primary-hover); }
.kb-capabilities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; border-top: 1px solid var(--border); padding: 32px 0; }
.kb-capabilities article { display: flex; min-width: 0; gap: 15px; align-items: flex-start; }
.capability-icon { display: grid; place-items: center; flex: 0 0 46px; height: 46px; border-radius: 12px; color: var(--primary); background: var(--primary-soft); }
.kb-capabilities h3 { margin: 2px 0 6px; color: var(--foreground); font-size: 16px; line-height: 1.5; }
.kb-capabilities p { max-width: 250px; margin: 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.7; }
.kb-count { color: var(--muted-foreground); font-size: 12px; }
.kb-search { display: flex; align-items: center; gap: 7px; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; color: var(--muted-foreground); background: var(--surface); }
.kb-search input { min-width: 0; width: 100%; border: 0; background: transparent; min-height: 40px; padding: 6px 0; font-size: 13px; }
.kb-search:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
.kb-search input:focus { outline: none; box-shadow: none; }
.kb-filter-empty { display: grid; gap: 8px; justify-items: center; padding: 25px 8px; font-size: 13px; color: var(--muted-foreground); text-align: center; }
.kb-inline-error { margin: 0; color: var(--danger-strong); font-size: 12px; line-height: 1.6; }
.kb-confirm-error { margin: 0; color: var(--danger-strong); font-size: 14px; line-height: 1.6; }

.kb-layout {
  display: grid;
  grid-template-columns: minmax(240px, 260px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.kb-sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
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
  gap: 10px;
}

.kb-create label {
  color: var(--foreground, #0f172a);
  font-size: 14px;
  font-weight: 700;
}

.kb-create input {
  min-height: 42px;
  background: var(--surface, #fff);
}

.kb-create:focus-within {
  outline: none;
}

.kb-create__hint,
.kb-create__error {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.kb-create__hint {
  color: var(--muted-foreground, #64748b);
}

.kb-create__error {
  color: var(--danger-strong, #dc2626);
}

.kb-create__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
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
  flex-direction: column;
  background: var(--surface, #fff);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
}

.kb-workspace__header {
  gap: 18px;
  margin-bottom: 24px;
}
.kb-workspace__header > div:first-child { min-width: 0; }

.kb-title-row {
  gap: 8px;
}

.kb-title-row h2 {
  margin: 0;
  color: var(--foreground, #0f172a);
  font-size: 23px;
  font-weight: 740;
  letter-spacing: -0.035em;
  overflow-wrap: anywhere;
}

.kb-title-edit {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.kb-title-edit input {
  min-width: 0;
  min-height: 42px;
  flex: 1;
  font-size: 16px;
  font-weight: 680;
}

.kb-title-edit button {
  min-height: 42px;
}

.kb-workspace__header p {
  margin: 7px 0 0;
  color: var(--muted-foreground, #64748b);
  font-size: 14px;
}

.kb-workspace__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.use-in-chat-button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 7px;
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
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  border: 1px dashed var(--primary-border, #c7d2fe);
  border-radius: var(--radius-lg, 10px);
  background: color-mix(in srgb, var(--primary-soft, #eef2ff) 32%, var(--surface, #fff));
  min-height: 76px;
  padding: 14px 16px;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.upload-zone.is-dragging {
  border-color: var(--primary, #4f46e5);
  background: var(--primary-soft, #eef2ff);
  transform: translateY(-1px);
}

.upload-zone.is-busy { opacity: .72; }
.upload-zone--empty { display: flex; min-height: 320px; flex-direction: column; justify-content: center; gap: 19px; padding: 38px 22px; text-align: center; background: var(--surface-muted); }
.upload-zone--empty .upload-zone__icon { width: 56px; height: 56px; border-radius: 14px; }
.upload-zone--empty .upload-zone__icon svg { width: 26px; height: 26px; }
.upload-zone--empty .upload-zone__copy { gap: 8px; }
.upload-zone--empty .upload-zone__copy strong { font-size: 23px; letter-spacing: -.025em; }
.upload-zone--empty .upload-zone__copy span { font-size: 14px; }
.upload-zone__copy small { max-width: 420px; color: var(--muted-foreground); font-size: 12px; line-height: 1.7; }

.upload-zone__icon {
  display: grid;
  width: 36px;
  height: 36px;
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

.kb-usage-guide {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
  border: 0;
  border-radius: var(--radius-lg, 10px);
  background: var(--surface-muted);
  padding: 12px 14px;
}

.kb-usage-guide__copy {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 10px;
}

.kb-usage-guide__copy strong {
  color: var(--foreground, #0f172a);
  font-size: 13px;
}

.kb-usage-guide__copy p {
  margin: 4px 0 0;
  color: var(--muted-foreground, #64748b);
  font-size: 12px;
  line-height: 1.5;
}

.kb-usage-guide__icon {
  display: inline-grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--surface, #fff);
  color: var(--success-strong, #047857);
}

.kb-usage-guide > button {
  display: inline-flex;
  min-height: 40px;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
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
  margin-top: 24px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: var(--radius-lg, 10px);
  background: var(--surface, #fff);
}

.retrieval-test__summary {
  width: 100%;
  min-height: 76px;
  gap: 14px;
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
    grid-template-columns: minmax(170px, 200px) minmax(0, 1fr);
    gap: 16px;
  }

  .kb-workspace {
    padding: 22px 20px;
  }
  .kb-workspace__header { align-items: flex-start; flex-wrap: wrap; }
  .kb-capabilities { gap: 18px; }
}

@media (max-width: 760px) {
  .kb-layout {
    min-height: auto;
    grid-template-columns: 1fr;
  }

  .kb-sidebar {
    padding: 16px;
  }

  .kb-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 200px;
    overflow-y: auto;
  }

  .kb-refresh {
    display: none;
  }

  .kb-workspace {
    min-height: 0;
  }
}

@media (max-width: 680px) {
  .kb-page { gap: 18px; }
  .kb-page--empty { gap: 0; }
  .kb-page-header { flex-wrap: wrap; gap: 12px; }
  .kb-page-header h1 { font-size: 24px; }
  .kb-page-header p { font-size: 13px; }
  .kb-page-actions { gap: 6px; }
  .kb-welcome { padding: 30px 0 36px; }
  .welcome-icon { width: 64px; height: 64px; margin-bottom: 20px; border-radius: 18px; }
  .welcome-icon svg { width: 31px; height: 31px; }
  .kb-welcome h2 { max-width: 310px; font-size: 27px; }
  .kb-welcome > p { max-width: 290px; font-size: 15px; }
  .welcome-actions { gap: 15px; margin-top: 24px; }
  .welcome-primary { min-height: 46px; padding: 11px 16px; font-size: 14px; }
  .kb-capabilities { grid-template-columns: minmax(0, 1fr); gap: 22px; padding: 26px 0; }
  .kb-capabilities h3 { font-size: 15px; margin-bottom: 4px; }
  .kb-capabilities p { max-width: none; font-size: 13px; }
  .capability-icon { flex-basis: 42px; height: 42px; border-radius: 11px; }
  .kb-list-item { grid-template-columns: auto minmax(0, 1fr); padding: 9px 7px; gap: 8px; }
  .kb-list-item > svg { display: none; }
  .kb-list-item__copy strong { font-size: 12px; }
  .kb-list-item__copy small { font-size: 11px; }
  .kb-workspace {
    min-height: 0;
    padding: 22px 16px 16px;
  }

  .kb-workspace__header {
    align-items: stretch;
    flex-direction: column;
  }

  .kb-title-edit {
    min-width: 0;
    flex-wrap: wrap;
  }

  .kb-title-edit input {
    flex-basis: 100%;
  }

  .kb-workspace__actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .primary-upload-button,
  .use-in-chat-button {
    width: 100%;
    justify-content: center;
  }

  .upload-zone {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 16px;
  }
  .upload-zone > .app-button { grid-column: 1 / -1; }
  .upload-zone--empty { min-height: 290px; padding: 28px 14px; }
  .upload-zone--empty .upload-zone__copy strong { font-size: 21px; }
  .upload-zone--empty .upload-zone__copy span { font-size: 13px; }

  .upload-zone__link {
    grid-column: 1 / -1;
    justify-self: stretch;
    border-top: 1px solid var(--border, #e2e8f0);
    padding: 12px 0 0;
    text-align: center;
  }

  .kb-usage-guide {
    align-items: stretch;
    flex-direction: column;
  }

  .kb-usage-guide > button {
    justify-content: center;
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
