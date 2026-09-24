<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, Clock3, MessageSquare, MessagesSquare, Plus, RefreshCw, Search, TextCursorInput, Trash2, X } from '@lucide/vue'
import { createConversation, deleteConversation, listConversations } from '@/api/app'
import { toAppError } from '@/api/errors'
import type { Conversation } from '@/api/types'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import DetailDrawer from '@/components/layout/DetailDrawer.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { formatBeijingTimeShort, parseServerDateTime } from '@/domain/date-time'

const title = ref('')
const query = ref('')
const conversations = ref<Conversation[]>([])
const loading = ref(true)
const hasLoaded = ref(false)
const loadError = ref('')
const notice = ref('')
const creating = ref(false)
const showCreate = ref(false)
const createError = ref('')
const deleteError = ref('')
const removingId = ref('')
const pendingDelete = ref<Conversation | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
const pageHeading = ref<HTMLElement | null>(null)
let createTrigger: HTMLElement | null = null
let refreshVersion = 0
let disposed = false
const sortedConversations = computed(() => [...conversations.value].sort((a, b) => dateTime(b.updatedAt || b.createdAt) - dateTime(a.updatedAt || a.createdAt)))
const filteredConversations = computed(() => sortedConversations.value.filter((item) => item.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const isEmpty = computed(() => hasLoaded.value && !loadError.value && !conversations.value.length)

async function refresh() {
  const version = ++refreshVersion
  loading.value = true
  loadError.value = ''
  try {
    const response = await listConversations()
    if (disposed || version !== refreshVersion) return
    conversations.value = response.data
    hasLoaded.value = true
  } catch (error) {
    if (!disposed && version === refreshVersion) loadError.value = toAppError(error, '对话暂时无法加载，请重试。').message
  } finally {
    if (!disposed && version === refreshVersion) loading.value = false
  }
}
async function openCreator(event: Event) {
  createTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  createError.value = ''
  showCreate.value = true
  await nextTick()
  titleInput.value?.focus()
}
async function closeCreator() {
  if (creating.value) return
  showCreate.value = false
  await nextTick()
  await nextTick()
  if (createTrigger?.isConnected) createTrigger.focus()
  else pageHeading.value?.focus()
}
async function create() {
  const name = title.value.trim()
  if (!name || creating.value) return
  creating.value = true
  createError.value = ''
  const needsListReload = !hasLoaded.value || Boolean(loadError.value)
  try {
    const response = await createConversation(name)
    if (disposed) return
    ++refreshVersion
    loading.value = false
    conversations.value = [response.data, ...conversations.value.filter((item) => item.id !== response.data.id)]
    query.value = ''
    title.value = ''
    notice.value = '对话已创建，点击标题即可开始聊天。'
    creating.value = false
    await closeCreator()
    if (needsListReload) await refresh()
  } catch (error) {
    if (!disposed) createError.value = toAppError(error, '对话创建失败，请重试。').message
  } finally {
    if (!disposed) creating.value = false
  }
}
function askToDelete(item: Conversation) {
  deleteError.value = ''
  pendingDelete.value = item
}
async function remove() {
  const item = pendingDelete.value
  if (!item || removingId.value) return
  removingId.value = item.id
  deleteError.value = ''
  try {
    await deleteConversation(item.id)
    if (disposed) return
    ++refreshVersion
    loading.value = false
    conversations.value = conversations.value.filter((entry) => entry.id !== item.id)
    notice.value = '对话已删除。'
    pendingDelete.value = null
    await nextTick()
    await nextTick()
    pageHeading.value?.focus()
  } catch (error) {
    if (!disposed) deleteError.value = toAppError(error, '对话删除失败，请重试。').message
  } finally {
    if (!disposed) removingId.value = ''
  }
}
function dateTime(value?: string | null) { return parseServerDateTime(value)?.getTime() || 0 }
onMounted(refresh)
onBeforeUnmount(() => { disposed = true; ++refreshVersion })
</script>

<template>
  <section class="conversations-page" :class="{ 'conversations-page--empty': isEmpty }" :aria-busy="loading">
    <header class="conversations-heading">
      <div><h1 ref="pageHeading" tabindex="-1">聊天记录</h1><p>查找普通聊天，继续上次的话题。</p></div>
      <div class="heading-actions">
        <AppButton variant="ghost" size="icon" aria-label="刷新聊天记录" :loading="loading" :disabled="creating || Boolean(removingId)" @click="refresh"><RefreshCw v-if="!loading" :size="18" aria-hidden="true" /></AppButton>
        <AppButton v-if="!isEmpty" :disabled="loading && !hasLoaded" @click="openCreator"><Plus :size="17" aria-hidden="true" />新建对话</AppButton>
      </div>
    </header>
    <p class="local-history-link">本地项目的对话按项目保存在此浏览器。<RouterLink to="/local-project">查看项目对话<ArrowRight :size="14" aria-hidden="true" /></RouterLink></p>
    <p v-if="notice" class="conversation-notice" role="status">{{ notice }}</p>
    <LoadingState v-if="loading && !hasLoaded" label="正在读取对话…" :cards="3" />
    <ErrorState v-else-if="loadError && !conversations.length" title="对话暂时无法加载" :message="loadError" :retrying="loading" @retry="refresh" />
    <template v-else>
      <div v-if="loadError" class="conversation-warning" role="alert"><span>对话列表未完整加载，当前仅显示已读取的内容。{{ loadError }}</span><AppButton variant="secondary" size="sm" :loading="loading" @click="refresh">重试</AppButton></div>
      <template v-if="isEmpty">
        <section class="conversations-welcome" aria-labelledby="conversations-welcome-title">
          <span class="welcome-icon"><MessagesSquare :size="36" :stroke-width="1.6" aria-hidden="true" /></span>
          <h2 id="conversations-welcome-title"><span>把想法留下，</span><span>下次接着聊</span></h2>
          <p>从一个问题开始，和 Lyle 一起理清思路。<br />普通聊天记录会保存在这里，随时回来继续。</p>
          <div class="welcome-actions">
            <AppButton class="welcome-primary" @click="openCreator"><Plus :size="19" aria-hidden="true" />新建对话</AppButton>
            <RouterLink class="text-action" :to="{ name: 'chat' }">直接去聊天<ArrowRight :size="17" aria-hidden="true" /></RouterLink>
          </div>
        </section>
        <section class="conversation-guide" aria-labelledby="conversation-guide-title">
          <div class="guide-heading"><h2 id="conversation-guide-title">让对话，成为思路的延续</h2><p>按主题整理，轻松找回之前的讨论。</p></div>
          <div class="guide-grid">
            <article><span class="guide-icon"><MessageSquare :size="22" aria-hidden="true" /></span><div><h3>一个话题，一段对话</h3><p>为工作、学习或灵感单独开启对话。</p></div></article>
            <article><span class="guide-icon guide-icon--blue"><Clock3 :size="22" aria-hidden="true" /></span><div><h3>随时继续</h3><p>最近更新的对话排在前面，方便接着聊。</p></div></article>
            <article><span class="guide-icon guide-icon--amber"><TextCursorInput :size="22" aria-hidden="true" /></span><div><h3>起个好找的名字</h3><p>用清楚的主题命名，之后搜索更方便。</p></div></article>
          </div>
        </section>
      </template>
      <section v-else class="conversation-library" aria-label="普通聊天记录">
        <div class="library-toolbar">
          <div class="library-title"><h2>{{ loadError ? '已读取的聊天记录' : '普通聊天记录' }}</h2><span>{{ conversations.length }}</span></div>
          <label class="conversation-search"><Search :size="18" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索对话" placeholder="搜索对话标题" /><button v-if="query" type="button" aria-label="清除搜索" @click="query = ''"><X :size="16" aria-hidden="true" /></button></label>
        </div>
        <div v-if="filteredConversations.length" class="conversation-list">
          <article v-for="item in filteredConversations" :key="item.id" class="conversation-item">
            <span class="conversation-item-icon"><MessageSquare :size="21" :stroke-width="1.7" aria-hidden="true" /></span>
            <RouterLink class="conversation-open" :to="{ name: 'chat', query: { conversationId: item.id } }">
              <div class="conversation-item-title"><h3>{{ item.title || '未命名对话' }}</h3><span v-if="item.id === sortedConversations[0]?.id" class="recent-tag">最近</span></div>
              <p>更新于 {{ formatBeijingTimeShort(item.updatedAt || item.createdAt, '暂无时间') }}</p>
            </RouterLink>
            <AppButton class="delete-conversation" variant="ghost" size="icon" :aria-label="'删除对话：' + item.title" :title="'删除对话：' + item.title" :disabled="Boolean(removingId)" @click="askToDelete(item)"><Trash2 :size="17" aria-hidden="true" /></AppButton>
            <RouterLink class="continue-conversation" :to="{ name: 'chat', query: { conversationId: item.id } }" :aria-label="'继续对话：' + item.title"><span>继续对话</span><ArrowRight :size="17" aria-hidden="true" /></RouterLink>
          </article>
        </div>
        <div v-else class="search-empty" role="status"><Search :size="28" aria-hidden="true" /><h3>没有找到相关对话</h3><p>换个关键词，或查看全部对话。</p><AppButton variant="secondary" size="sm" @click="query = ''">清除搜索</AppButton></div>
        <footer class="library-footer"><span aria-live="polite">{{ query.trim() ? '找到 ' + filteredConversations.length + ' 个对话' : conversations.length + ' 个对话' }}</span><span>按最近更新排序</span></footer>
      </section>
    </template>
    <DetailDrawer :open="showCreate" title="新建对话" description="给这次讨论起个名字，之后更容易找到。" @update:open="(open) => { if (!open) closeCreator() }">
      <form class="conversation-create-form" @submit.prevent="create">
        <label for="conversation-title">对话标题</label>
        <input id="conversation-title" ref="titleInput" v-model="title" autofocus required maxlength="255" placeholder="例如：产品方案讨论" :disabled="creating" :aria-invalid="Boolean(createError)" :aria-describedby="createError ? 'conversation-create-error' : 'conversation-title-hint'" @input="createError = ''" />
        <p id="conversation-title-hint" class="form-hint">可以用项目名称、问题或一个想法作为标题。</p>
        <p v-if="createError" id="conversation-create-error" class="form-error" role="alert">{{ createError }}</p>
        <div class="create-actions"><AppButton variant="secondary" :disabled="creating" @click="closeCreator">取消</AppButton><AppButton type="submit" :loading="creating" :disabled="!title.trim()">{{ creating ? '创建中…' : '创建对话' }}</AppButton></div>
      </form>
    </DetailDrawer>
    <ConfirmActionDialog :open="Boolean(pendingDelete)" title="删除对话" :description="'删除“' + (pendingDelete?.title || '') + '”后，对话和聊天消息将被移除；由它创建的任务、项目关联和已确认记忆会保留。'" confirm-label="确认删除" danger :busy="Boolean(removingId)" @update:open="(open) => { if (!open) pendingDelete = null }" @confirm="remove"><p v-if="deleteError" class="form-error" role="alert">{{ deleteError }}</p></ConfirmActionDialog>
  </section>
</template>

<style scoped>
.local-history-link { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0; padding: 12px 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.7; }
.local-history-link a { display: inline-flex; align-items: center; gap: 4px; color: var(--primary); text-decoration: none; }
.local-history-link a:hover { text-decoration: underline; }
.conversations-page { display: grid; gap: 24px; width: min(100%, 1180px); min-width: 0; margin: 0 auto; }
.conversations-page--empty { gap: 0; }
.conversations-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.conversations-heading h1 { margin: 0; font-size: 25px; font-weight: 700; line-height: 1.4; letter-spacing: -.02em; }
.conversations-heading p { margin: 7px 0 0; color: var(--muted-foreground); font-size: 14px; }
.heading-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.conversation-notice { margin: 16px 0 0; padding: 11px 15px; border: 1px solid var(--success-border, #bbf7d0); border-radius: 10px; background: var(--success-soft, #ecfdf5); color: var(--success-strong, #047857); font-size: 14px; }
.conversation-warning { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-radius: 10px; padding: 14px; background: var(--warning-soft); color: var(--warning-strong); font-size: 14px; }
.conversations-welcome { display: flex; flex-direction: column; align-items: center; padding: 48px 24px 52px; text-align: center; }
.welcome-icon { display: grid; place-items: center; width: 76px; height: 76px; margin-bottom: 24px; border-radius: 20px; background: var(--primary-soft); color: var(--primary); }
.conversations-welcome h2 { margin: 0; font-size: 34px; font-weight: 750; line-height: 1.45; letter-spacing: -.035em; }
.conversations-welcome h2 span { display: inline-block; }
.conversations-welcome > p { margin: 16px 0 0; font-size: 16px; line-height: 1.8; color: var(--muted-foreground); }
.welcome-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 26px; margin-top: 28px; }
.welcome-primary { min-height: 48px; padding: 12px 21px; font-size: 15px; border-radius: 10px; }
.text-action { display: inline-flex; align-items: center; gap: 9px; color: var(--primary); font-size: 15px; font-weight: 650; text-decoration: none; }
.text-action:hover { color: var(--primary-hover); }
.conversation-guide { border-top: 1px solid var(--border); padding-top: 27px; }
.guide-heading h2 { margin: 0; font-size: 19px; font-weight: 700; }
.guide-heading p { margin: 7px 0 20px; color: var(--muted-foreground); font-size: 14px; }
.guide-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.guide-grid article { display: flex; align-items: flex-start; gap: 15px; padding: 23px 21px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.guide-icon { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border-radius: 12px; background: var(--primary-soft); color: var(--primary); }
.guide-icon--blue { color: #0284c7; background: #f0f9ff; }
.guide-icon--amber { color: #b45309; background: #fffbeb; }
.guide-grid h3 { margin: 0 0 7px; font-size: 15px; font-weight: 700; }
.guide-grid p { margin: 0; font-size: 13px; line-height: 1.75; color: var(--muted-foreground); }
.conversation-library { min-width: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.library-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 24px; border-bottom: 1px solid var(--border); }
.library-title { display: flex; align-items: center; gap: 10px; }
.library-title h2 { margin: 0; font-size: 16px; font-weight: 700; white-space: nowrap; }
.library-title > span { border-radius: 6px; padding: 2px 7px; font-size: 12px; font-weight: 650; background: var(--surface-muted); color: var(--muted-foreground); }
.conversation-search { display: flex; align-items: center; gap: 9px; width: min(100%, 300px); padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted-foreground); background: var(--surface); }
.conversation-search:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
.conversation-search input { min-width: 0; width: 100%; border: 0; box-shadow: none; outline: none; background: transparent; padding: 10px 0; font-size: 13px; }
.conversation-search input::-webkit-search-cancel-button { display: none; }
.conversation-search button { display: grid; place-items: center; padding: 0; width: 24px; height: 28px; flex-shrink: 0; color: var(--muted-foreground); background: transparent; }
.conversation-list { padding: 0 24px; }
.conversation-item { display: flex; align-items: center; gap: 15px; padding: 22px 0; }
.conversation-item + .conversation-item { border-top: 1px solid var(--border); }
.conversation-item-icon { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 11px; background: var(--surface-muted); color: var(--muted-foreground); }
.conversation-open { flex: 1; min-width: 0; text-decoration: none; color: var(--foreground); }
.conversation-item-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.conversation-item h3 { margin: 0; font-size: 15px; line-height: 1.5; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-open:hover h3 { color: var(--primary); }
.conversation-open p { margin: 6px 0 0; font-size: 12px; color: var(--muted-foreground); }
.recent-tag { flex-shrink: 0; padding: 2px 6px; border-radius: 5px; font-size: 11px; line-height: 1.5; color: var(--primary); background: var(--primary-soft); }
.delete-conversation { flex-shrink: 0; }
.delete-conversation:hover { color: var(--danger); }
.continue-conversation { display: inline-flex; align-items: center; gap: 8px; padding: 10px 0 10px 5px; flex-shrink: 0; font-size: 13px; font-weight: 600; color: var(--muted-foreground); text-decoration: none; }
.continue-conversation:hover { color: var(--primary); }
.library-footer { display: flex; justify-content: space-between; gap: 15px; padding: 14px 24px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted-foreground); }
.search-empty { display: flex; flex-direction: column; align-items: center; padding: 62px 20px; text-align: center; color: var(--muted-foreground); }
.search-empty h3 { color: var(--foreground); font-size: 17px; margin: 15px 0 0; }
.search-empty p { margin: 8px 0 20px; font-size: 14px; }
.conversation-create-form { display: grid; gap: 10px; }
.conversation-create-form label { font-size: 14px; font-weight: 650; }
.conversation-create-form input { width: 100%; min-width: 0; font-size: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 9px; }
.form-hint { color: var(--muted-foreground); font-size: 13px; line-height: 1.7; margin: 0; }
.form-error { color: var(--danger); font-size: 13px; line-height: 1.6; margin: 0; }
.create-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.conversations-page a:focus-visible, .conversations-page button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
@media (max-width: 1000px) {
  .guide-grid { gap: 12px; }
  .guide-grid article { flex-direction: column; padding: 18px; gap: 13px; }
}
@media (max-width: 640px) {
  .conversations-page { gap: 20px; }
  .conversations-page--empty { gap: 0; }
  .conversations-heading { gap: 12px; align-items: flex-start; }
  .conversations-heading h1 { font-size: 23px; }
  .conversations-heading p { max-width: 180px; line-height: 1.6; font-size: 13px; }
  .heading-actions { gap: 4px; }
  .heading-actions :deep(.app-button:not(.size-icon)) { padding: 9px 10px; font-size: 13px; }
  .conversations-welcome { padding: 32px 4px 38px; }
  .welcome-icon { width: 64px; height: 64px; margin-bottom: 20px; border-radius: 18px; }
  .conversations-welcome h2 { max-width: 300px; font-size: 27px; }
  .conversations-welcome > p { font-size: 14px; margin-top: 13px; }
  .welcome-actions { gap: 20px; margin-top: 24px; }
  .welcome-primary { min-height: 46px; padding: 11px 16px; font-size: 14px; }
  .text-action { font-size: 14px; }
  .conversation-guide { padding-top: 24px; }
  .guide-heading h2 { font-size: 17px; }
  .guide-grid { grid-template-columns: 1fr; gap: 10px; }
  .guide-grid article { flex-direction: row; padding: 16px; }
  .guide-grid h3 { margin-bottom: 4px; font-size: 14px; }
  .library-toolbar { align-items: stretch; flex-direction: column; padding: 18px 16px; gap: 15px; }
  .conversation-search { width: 100%; }
  .conversation-list { padding: 0 16px; }
  .conversation-item { gap: 10px; padding: 18px 0; }
  .conversation-item-icon { display: none; }
  .conversation-item-title { gap: 6px; }
  .conversation-item h3 { font-size: 14px; }
  .continue-conversation span { display: none; }
  .continue-conversation { justify-content: center; width: 30px; min-height: 40px; padding: 0; }
  .delete-conversation { width: 32px; }
  .library-footer { padding: 13px 16px; font-size: 11px; }
  .conversation-warning { align-items: flex-start; flex-direction: column; }
}
</style>
