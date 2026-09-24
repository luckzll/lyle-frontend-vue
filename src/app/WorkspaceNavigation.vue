<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bot, ChevronRight, FolderOpen, LoaderCircle, MessageSquare, Plus, Trash2 } from '@lucide/vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import { deleteConversation } from '@/api/app'
import { chooseLocalDirectory } from '@/domain/local-workspace'
import { stageDirectorySelection, discardDirectorySelection } from '@/domain/local-directory-selection'
import type { User } from '@/api/types'
import { requestAuth } from '@/composables/useAuthGate'
import { useChatNavigation } from '@/composables/useChatNavigation'
import { useLocalProjectNavigation } from '@/composables/useLocalProjectNavigation'

const props = defineProps<{ section: 'chat' | 'projects'; collapsed?: boolean; user: User | null }>()
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const router = useRouter()
const open = ref(true)
const actionError = ref('')
const pendingChatDelete = ref<{ id: string; title: string } | null>(null)
const deleting = ref(false)
const picking = ref(false)
const chatLimit = ref(8)
const expandedProjects = ref(new Set<string>())
const projectLimits = ref<Record<string, number>>({})
const label = computed(() => props.section === 'chat' ? '聊天' : '项目')
const active = computed(() => props.section === 'chat' ? ['chat', 'conversations'].includes(String(route.name)) : route.name === 'local-project')
const chats = useChatNavigation({ owner: () => props.section === 'chat' ? props.user?.id : undefined, limit: 8 })
const local = useLocalProjectNavigation(() => props.section === 'projects' ? props.user?.id : undefined)
const projects = computed(() => [...local.projects.value].sort((a, b) => b.updatedAt - a.updatedAt))
const sessionsFor = (id: string) => local.sessions.value.filter(s => s.projectId === id).slice().sort((a, b) => b.updatedAt - a.updatedAt)
const visibleSessions = (id: string) => sessionsFor(id).slice(0, projectLimits.value[id] || 5)
const unassigned = computed(() => local.sessions.value.filter(s => !s.projectId))
const selectedSession = computed(() => route.name === 'local-project' ? String(route.query.sessionId || local.activeId.value || '') : '')
const selectedProject = computed(() => route.name === 'local-project' ? String(route.query.projectId || local.activeProjectId.value || '') : '')

watch(() => props.user?.id, () => { expandedProjects.value = new Set(); projectLimits.value = {}; chatLimit.value = 8 })
watch(selectedProject, id => { if (id) expandedProjects.value.add(id) }, { immediate: true })
watch(() => route.fullPath, () => { if (active.value) open.value = true })
watch([() => route.query.conversationId, chats.conversations], () => {
  const index = chats.conversations.value.findIndex(chat => String(chat.id) === String(route.query.conversationId))
  if (index >= chatLimit.value) chatLimit.value = Math.ceil((index + 1) / 8) * 8
})
watch([selectedSession, local.sessions], () => {
  const id = selectedProject.value
  const index = sessionsFor(id).findIndex(session => session.id === selectedSession.value)
  if (id && index >= (projectLimits.value[id] || 5)) projectLimits.value[id] = Math.ceil((index + 1) / 5) * 5
}, { immediate: true })

function toggleProject(id: string) {
  if (expandedProjects.value.has(id)) expandedProjects.value.delete(id)
  else expandedProjects.value.add(id)
}
function projectLocation(projectId?: string | null, sessionId?: string) {
  return { name: 'local-project', query: { ...(projectId ? { projectId } : {}), ...(sessionId ? { sessionId } : {}) } }
}
async function createChat() {
  if (!props.user) { emit('navigate'); requestAuth('/', '新建聊天'); return }
  await chats.startNewChat()
  open.value = true
  emit('navigate')
}
async function projectAction(action: 'add-project' | 'new-chat' | 'delete-project' | 'delete-session', projectId?: string, sessionId?: string) {
  if (!props.user) { emit('navigate'); requestAuth('/local-project', '打开本地项目'); return }
  if (picking.value) return
  const owner = String(props.user.id)
  const request = crypto.randomUUID()
  actionError.value = ''
  try {
    if (action === 'add-project') {
      picking.value = true
      const handle = await chooseLocalDirectory()
      if (String(props.user?.id) !== owner) return
      stageDirectorySelection(request, owner, handle)
    }
    const failure = await router.push({ name: 'local-project', query: { action, request, ...(projectId ? { projectId } : {}), ...(sessionId ? { sessionId } : {}) } })
    if (failure) { discardDirectorySelection(request); actionError.value = '请先停止当前任务或完成目录授权，再操作项目'; return }
    open.value = true
    emit('navigate')
  } catch (e) {
    discardDirectorySelection(request)
    if (!(e instanceof DOMException && e.name === 'AbortError')) actionError.value = e instanceof Error ? e.message : '项目操作失败，请重试'
  } finally { picking.value = false }
}
async function removeChat() {
  const target = pendingChatDelete.value
  if (!target || deleting.value) return
  const owner = props.user?.id
  deleting.value = true; actionError.value = ''
  try {
    await deleteConversation(target.id)
    if (props.user?.id !== owner) return
    pendingChatDelete.value = null
    if (route.name === 'chat' && String(route.query.conversationId) === target.id) await chats.startNewChat()
    await chats.refresh()
  } catch { actionError.value = '删除聊天失败，请重试。' }
  finally { deleting.value = false }
}
watch(() => props.user?.id, () => { pendingChatDelete.value = null; actionError.value = '' })
</script>

<template>
  <div class="workspace-nav" :class="{ 'is-collapsed': collapsed }">
    <RouterLink v-if="collapsed" class="workspace-shortcut" :class="{ 'is-active': active }" :to="section === 'chat' ? '/' : '/local-project'" :aria-label="label" :title="label" :aria-current="active ? 'page' : undefined" @click="emit('navigate')">
      <MessageSquare v-if="section === 'chat'" :size="19" /><FolderOpen v-else :size="19" />
    </RouterLink>
    <template v-else>
      <p v-if="actionError" class="nav-state nav-error" role="alert">{{ actionError }}</p>
      <div class="workspace-heading" :class="{ 'is-active': active }">
        <button class="section-toggle" :aria-expanded="open" :aria-label="`${open ? '收起' : '展开'}${label}记录`" @click="open = !open">
          <MessageSquare v-if="section === 'chat'" :size="19" :stroke-width="1.8" /><FolderOpen v-else :size="19" :stroke-width="1.8" />
          <span>{{ label }}</span>
        </button>
        <button class="nav-icon section-add" :disabled="picking" :aria-label="section === 'chat' ? '新建聊天' : '添加本地项目'" :title="section === 'chat' ? '新建聊天' : '添加本地项目'" @click="section === 'chat' ? createChat() : projectAction('add-project')"><Plus :size="17" /></button>
      </div>

      <div v-if="open" class="workspace-children">
        <template v-if="section === 'chat'">
          <p v-if="chats.loading.value && !chats.conversations.value.length" class="nav-state"><LoaderCircle class="spin" :size="13" />正在加载对话</p>
          <div v-if="chats.error.value" class="nav-state nav-error" role="status">{{ chats.error.value }}<button @click="chats.refresh()">重试</button></div>
          <div v-for="chat in chats.conversations.value.slice(0, chatLimit)" :key="chat.id" class="workspace-conversation-row"><RouterLink class="conversation-link" :class="{ selected: route.name === 'chat' && String(route.query.conversationId) === String(chat.id) }" :to="chats.conversationLocation(chat.id)" :title="chat.title || '新对话'" :aria-current="route.name === 'chat' && String(route.query.conversationId) === String(chat.id) ? 'page' : undefined" @click="emit('navigate')"><span>{{ chat.title || '新对话' }}</span></RouterLink><button class="nav-icon row-delete" :aria-label="`删除聊天：${chat.title || '新对话'}`" title="删除对话" @click="pendingChatDelete = { id: String(chat.id), title: chat.title || '新对话' }"><Trash2 :size="14" /></button></div>
          <button v-if="!chats.loading.value && !chats.error.value && !chats.conversations.value.length" class="nav-empty" @click="createChat()"><Plus :size="14" />开始第一段聊天</button>
          <button v-if="chats.conversations.value.length > chatLimit" class="show-more" @click="chatLimit += 8">展开更多聊天</button>
          <RouterLink v-if="user" class="manage-history" :class="{ selected: route.name === 'conversations' }" to="/conversations" @click="emit('navigate')">管理聊天记录<ChevronRight :size="12" /></RouterLink>
        </template>

        <template v-else>
          <div v-if="local.error.value" class="nav-state nav-error" role="status">{{ local.error.value }}<button @click="local.refresh()">重试</button></div>
          <div v-for="project in projects" :key="project.id" class="nav-project">
            <div class="project-heading">
              <button class="project-chevron nav-icon" :aria-label="`${expandedProjects.has(project.id) ? '收起' : '展开'}项目：${project.name}`" :aria-expanded="expandedProjects.has(project.id)" @click="toggleProject(project.id)"><ChevronRight :size="12" :class="{ expanded: expandedProjects.has(project.id) }" /></button>
              <RouterLink class="project-name" :class="{ selected: selectedProject === project.id }" :to="projectLocation(project.id)" :title="project.name" @click="expandedProjects.add(project.id); emit('navigate')"><FolderOpen :size="16" /><span>{{ project.name }}</span></RouterLink>
              <button class="nav-icon project-add" :aria-label="`在 ${project.name} 中新建聊天`" title="新建项目聊天" @click="projectAction('new-chat', project.id)"><Plus :size="14" /></button><button class="nav-icon row-delete" :aria-label="`删除项目：${project.name}`" title="删除项目" @click="projectAction('delete-project', project.id)"><Trash2 :size="14" /></button>
            </div>
            <div v-if="expandedProjects.has(project.id)" class="project-children">
              <div v-for="session in visibleSessions(project.id)" :key="session.id" class="workspace-conversation-row"><RouterLink class="conversation-link" :class="{ selected: selectedSession === session.id }" :to="projectLocation(project.id, session.id)" :title="`${session.title || '新对话'} · ${session.kind === 'agent' ? '智能体' : '聊天'}`" :aria-current="selectedSession === session.id ? 'page' : undefined" @click="emit('navigate')"><span>{{ session.title || '新对话' }}</span><Bot v-if="session.kind === 'agent'" class="kind-icon" :size="12" aria-label="智能体" /></RouterLink><button class="nav-icon row-delete" :aria-label="`删除对话：${session.title || '新对话'}`" title="删除对话" @click="projectAction('delete-session', session.projectId || undefined, session.id)"><Trash2 :size="14" /></button></div>
              <button v-if="!sessionsFor(project.id).length" class="nav-empty" @click="projectAction('new-chat', project.id)"><Plus :size="13" />新建聊天</button>
              <button v-if="sessionsFor(project.id).length > (projectLimits[project.id] || 5)" class="show-more" @click="projectLimits[project.id] = (projectLimits[project.id] || 5) + 5">展开更多对话</button>
            </div>
          </div>
          <div v-if="unassigned.length" class="unassigned"><p>未归类的历史对话</p><div v-for="session in unassigned" :key="session.id" class="workspace-conversation-row"><RouterLink class="conversation-link" :class="{ selected: selectedSession === session.id }" :to="projectLocation(null, session.id)" @click="emit('navigate')"><span>{{ session.title }}</span></RouterLink><button class="nav-icon row-delete" :aria-label="`删除对话：${session.title || '新对话'}`" title="删除对话" @click="projectAction('delete-session', session.projectId || undefined, session.id)"><Trash2 :size="14" /></button></div></div>
          <button v-if="!projects.length && !local.error.value" class="nav-empty" @click="projectAction('add-project')"><Plus :size="14" />添加一个本地项目</button>
        </template>
      </div>
    </template>
    <ConfirmActionDialog :open="!!pendingChatDelete" title="删除这段聊天？" :description="`将删除“${pendingChatDelete?.title || '新对话'}”及其消息，此操作不可撤销。`" confirm-label="删除聊天" danger :busy="deleting" @update:open="value => { if (!value) pendingChatDelete = null }" @confirm="removeChat"><template v-if="actionError" #default><p role="alert">{{ actionError }}</p></template></ConfirmActionDialog>
  </div>
</template>

<style scoped>
.workspace-nav{min-width:0;margin-top:3px;color:var(--sidebar-foreground)}
.workspace-heading{display:flex;align-items:center;border-radius:8px;min-height:40px;gap:2px;padding-right:4px}
.workspace-heading.is-active{color:var(--sidebar-active-fg)}
.section-toggle{display:flex;align-items:center;gap:var(--lyle-space-3);flex:1;min-width:0;min-height:40px;border:0;background:transparent;color:inherit;text-align:left;padding:.55rem .65rem;font-size:14px;font-weight:600}
.section-toggle span{flex:1}.section-toggle>svg{flex-shrink:0}
.workspace-heading:hover{background:var(--surface-muted)}
.nav-icon{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;background:transparent;color:var(--muted-foreground);border:0;border-radius:6px;padding:0}
.nav-icon:hover{background:var(--secondary);color:var(--foreground)}
.workspace-conversation-row{display:flex;align-items:center;min-width:0}.workspace-conversation-row>.conversation-link{flex:1}.row-delete{flex-basis:24px;width:24px}.row-delete:hover{color:var(--danger)}
.workspace-children{padding:1px 0 8px 22px;min-width:0}
.conversation-link{display:flex;align-items:center;min-width:0;min-height:34px;gap:5px;padding:7px 9px;border-radius:8px;color:var(--sidebar-foreground);font-size:13px;line-height:1.65;font-weight:400}
.conversation-link span,.project-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.conversation-link:hover,.project-name:hover{background:var(--surface-muted);color:var(--foreground)}
.conversation-link.selected{background:var(--sidebar-active-bg);color:var(--sidebar-active-fg);font-weight:550}
.kind-icon{flex-shrink:0;color:var(--muted-foreground)}
.manage-history,.show-more,.nav-empty{display:flex;align-items:center;gap:5px;background:transparent;border:0;color:var(--muted-foreground);padding:7px 9px;font-size:11px;text-align:left;line-height:1.6;border-radius:6px}
.manage-history{margin-top:3px}.manage-history:hover,.manage-history.selected,.show-more:hover,.nav-empty:hover{color:var(--primary);background:var(--surface-muted)}
.nav-project{margin:3px 0 8px}.project-heading{display:flex;align-items:center;min-width:0;margin-left:-19px;gap:1px}
.project-chevron{flex-basis:18px;width:18px}.project-chevron svg{transition:transform .15s}.project-chevron .expanded{transform:rotate(90deg)}
.project-name{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding:7px 3px;border-radius:6px;color:var(--sidebar-foreground);font-size:13px;font-weight:550}.project-name.selected{color:var(--foreground)}.project-name svg{flex-shrink:0}
.project-add{flex-basis:24px;width:24px}
.section-add,.project-add,.row-delete{opacity:0;pointer-events:none}
.workspace-heading:hover>.section-add,.project-heading:hover>.project-add,.section-add:focus-visible,.project-add:focus-visible,.row-delete:focus-visible,.workspace-conversation-row:hover>.row-delete,.project-heading:hover>.row-delete{opacity:1;pointer-events:auto}
@media(hover:none),(pointer:coarse){.section-add,.project-add,.row-delete{opacity:1;pointer-events:auto}}
.project-children{padding-left:4px}.project-children .conversation-link{padding-left:8px}
.nav-state{font-size:11px;line-height:1.6;color:var(--muted-foreground);margin:6px 8px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.nav-state button{padding:0;background:none;border:0;color:var(--primary);font-size:11px}.nav-error{color:var(--danger)}
.unassigned>p{font-size:10px;color:var(--muted-foreground);padding:5px 8px;margin:0}
.workspace-shortcut{display:grid;place-items:center;min-height:40px;border-radius:8px;color:var(--sidebar-foreground)}.workspace-shortcut:hover{background:var(--surface-muted)}.workspace-shortcut.is-active{background:var(--sidebar-active-bg);color:var(--sidebar-active-fg)}
button:focus-visible,a:focus-visible{outline:2px solid var(--ring);outline-offset:2px}.spin{animation:nav-spin 1s linear infinite}@keyframes nav-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}
@media(max-width:767px){.section-toggle{font-size:15px;min-height:44px;padding:.6rem .7rem}.conversation-link{font-size:13px;min-height:40px}.project-name{font-size:13px;min-height:40px}.nav-icon{min-height:32px}.show-more,.manage-history,.nav-empty{font-size:12px;min-height:36px}}
</style>
