<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink, onBeforeRouteLeave } from 'vue-router'
import { ArrowUp, Check, ChevronRight, FileCode, FolderOpen, LoaderCircle, ShieldCheck, Square, X } from '@lucide/vue'
import { workspaceStep } from '@/api/local-workspace'
import LocalProjectText from '@/components/chat/LocalProjectText.vue'
import { LocalWorkspace, chooseLocalDirectory, takeLocalDrop, stageLocalDrop, type ChangePreview, type WorkspaceMessage, type LocalDirectoryHandle } from '@/domain/local-workspace'

type Activity = { label: string; path?: string; status: 'running' | 'done' | 'error' | 'waiting'; detail?: string }
type Turn = { question: string; answer: string; activities: Activity[]; open: boolean; completed: boolean }
const workspace = shallowRef<LocalWorkspace>()
const input = ref(''); const error = ref(''); const loading = ref(false); const dragging = ref(false)
const turns = ref<Turn[]>([]); const transcript: WorkspaceMessage[] = []
const tree = ref<{ name: string; kind: string; path: string }[]>([])
const treePath = ref(''); const treeOpen = ref(false); const treeOffset = ref(0); const nextOffset = ref<number | null>(null)
const preview = shallowRef<ChangePreview>(); const applying = ref(false)
const bottom = ref<HTMLElement>(); let controller: AbortController | null = null
let answerChange: ((accepted: boolean) => void) | null = null
const canSend = computed(() => !!workspace.value && !!input.value.trim() && !loading.value)
const labels: Record<string, string> = { workspace_list: '查看目录', workspace_read: '读取文件', workspace_search: '搜索项目', workspace_edit: '修改文件', workspace_create: '新建文件' }

async function connect(handle?: LocalDirectoryHandle | null) {
  if (loading.value) return
  try {
    error.value = ''
    const root = handle || await chooseLocalDirectory()
    if (await root.queryPermission({ mode: 'read' }) !== 'granted') {
      if (await root.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('没有获得目录读取权限')
    }
    workspace.value = new LocalWorkspace(root)
    transcript.length = 0; turns.value = []; treePath.value = ''; treeOffset.value = 0
    await browse('')
  } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) error.value = e instanceof Error ? e.message : '目录连接失败，请重新选择' }
}
async function browse(path: string, offset = 0) {
  try {
    const result = await workspace.value?.list(path, offset)
    if (!result) return
    treePath.value = path; treeOffset.value = offset; tree.value = result.entries; nextOffset.value = result.nextOffset
    if (result.scanCapped) error.value = '该目录条目较多，仅列出前 3000 项；可进入具体子目录读取。'
  } catch { error.value = '目录不可用，请重新连接项目' }
}
function stop() {
  controller?.abort(); answerChange?.(false); answerChange = null; preview.value = undefined
}
function clear() { if (!loading.value) { transcript.length = 0; turns.value = []; error.value = '' } }
async function applyPreview() {
  if (!preview.value || !workspace.value || applying.value) return
  applying.value = true; error.value = ''
  try {
    // This runs directly from the user's click, as required for browser write permission.
    if (await workspace.value.root.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('未授予写入权限，文件未修改')
    answerChange?.(true)
  } catch (e) { error.value = e instanceof Error ? e.message : '无法获得写入权限' }
  finally { applying.value = false }
}
function rejectPreview() { answerChange?.(false) }
async function send() {
  if (!canSend.value || !workspace.value) return
  const activeWorkspace = workspace.value
  const question = input.value.trim(); input.value = ''; error.value = ''; loading.value = true
  controller = new AbortController(); const signal = controller.signal
  const turn: Turn = { question, answer: '', activities: [], open: true, completed: false }
  turns.value.push(turn); const current = turns.value[turns.value.length - 1]!
  const historyStart = transcript.length
  const rejectedPaths = new Set<string>()
  transcript.push({ role: 'user', content: question })
  try {
    for (let step = 0; step < 16; step++) {
      signal.throwIfAborted()
      if (JSON.stringify(transcript).length > 200_000) throw new Error('本地上下文已满，请新建本地对话；文件保留在原目录')
      let commentary = ''
      const modelActivity: Activity = { label: '分析下一步', status: 'running' }
      current.activities.push(modelActivity)
      const activity = current.activities[current.activities.length - 1]!
      const result = await workspaceStep(transcript, signal, text => { commentary += text; activity.detail = commentary })
      activity.status = 'done'; transcript.push(result)
      if (!result.tool_calls?.length) {
        current.answer = result.content
        current.activities.pop() // final answer belongs outside the process timeline
        current.completed = true; current.open = false
        break
      }
      const seen = new Set<string>()
      for (const call of result.tool_calls) {
        signal.throwIfAborted()
        if (!call.id || seen.has(call.id) || !labels[call.name] || !call.args || typeof call.args !== 'object') throw new Error('模型返回了无效的工具请求，已停止')
        seen.add(call.id)
        current.activities.push({ label: labels[call.name]!, path: String(call.args.path || '/'), status: 'running' })
        const row = current.activities[current.activities.length - 1]!
        let outcome: unknown
        try {
          if (call.name === 'workspace_edit' || call.name === 'workspace_create') {
            if (rejectedPaths.has(String(call.args.path))) throw new Error('用户已拒绝此文件的修改，本轮不再申请')
            const change = await activeWorkspace.preview(call)
            signal.throwIfAborted(); preview.value = change; row.status = 'waiting'
            const accepted = await new Promise<boolean>(resolve => { answerChange = resolve })
            answerChange = null; preview.value = undefined; signal.throwIfAborted()
            if (accepted) { row.status = 'running'; outcome = await activeWorkspace.apply(change, signal); row.detail = '已写入本地并复核内容' }
            else { rejectedPaths.add(change.path); outcome = { status: 'rejected', message: '用户拒绝此修改，文件未写入。不得重试这项修改。' }; row.detail = '已拒绝，文件未修改' }
          } else outcome = await activeWorkspace.executeRead(call, signal)
          row.status = 'done'
        } catch (e) {
          if (signal.aborted) throw e
          const message = e instanceof Error ? e.message : '文件操作失败'
          outcome = { status: 'error', message }; row.status = 'error'; row.detail = message
        }
        transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) })
      }
      if (step === 15) throw new Error('已达到本轮 16 步上限；已完成的文件修改保留，请检查后继续')
    }
  } catch (e) {
    error.value = signal.aborted ? '任务已停止。已完成的修改不会自动撤销。' : e instanceof Error ? e.message : '任务失败'
    // Do not send incomplete assistant/tool pairs on the next turn. Applied filesystem effects are real;
    // future turns must inspect the current disk state again.
    transcript.splice(historyStart)
    for (const activity of current.activities) if (activity.status === 'running' || activity.status === 'waiting') activity.status = 'error'
  } finally {
    loading.value = false; controller = null; answerChange = null; preview.value = undefined
    await nextTick(); bottom.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}
async function drop(event: DragEvent) {
  dragging.value = false
  if (loading.value || !event.dataTransfer) return
  if (!stageLocalDrop(event.dataTransfer)) { error.value = '请拖入一个项目文件夹，或点击“连接本地项目”'; return }
  try {
    const handle = await takeLocalDrop()
    if (!handle) { error.value = '当前拖拽无法获得目录权限，请点击“连接本地项目”选择目录'; return }
    await connect(handle)
  } catch { error.value = '目录连接失败，请点击按钮重新选择' }
}
onMounted(async () => { const handle = await takeLocalDrop().catch(() => null); if (handle) await connect(handle) })
onBeforeUnmount(stop)
onBeforeRouteLeave(() => { stop() })
</script>

<template>
  <main class="local-project" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="drop">
    <header class="project-header">
      <div><RouterLink to="/" class="back-link">返回聊天</RouterLink><h1>本地项目</h1><p>按需读取，直接修改你授权的目录。</p></div>
      <button class="secondary" :disabled="loading" @click="clear">新建本地对话</button>
    </header>
    <section class="project-card" :class="{ connected: workspace, dragging }">
      <div class="project-card-row">
        <span class="folder-icon"><FolderOpen :size="25" /></span>
        <button v-if="workspace" class="project-name" :aria-expanded="treeOpen" @click="treeOpen = !treeOpen"><strong>{{ workspace.root.name }}</strong><small>本地目录 · 文件未上传</small></button>
        <div v-else class="project-name"><strong>连接你的项目目录</strong><small>拖入文件夹，或点击右侧按钮选择</small></div>
        <button class="connect-button" :disabled="loading" @click="connect()">{{ workspace ? '更换目录' : '连接本地项目' }}</button>
        <button v-if="workspace" class="icon-button" aria-label="展开文件树" :aria-expanded="treeOpen" @click="treeOpen = !treeOpen"><ChevronRight :size="18" :class="{ expanded: treeOpen }" /></button>
      </div>
      <div v-if="workspace && treeOpen" class="project-tree">
        <div class="tree-location"><button :disabled="!treePath" @click="browse(treePath.split('/').slice(0, -1).join('/'))">上一级</button><span>{{ treePath || '/' }}</span></div>
        <button v-for="item in tree" :key="item.path" class="tree-file" :disabled="item.kind !== 'directory'" @click="browse(item.path)"><FolderOpen v-if="item.kind === 'directory'" :size="15" /><FileCode v-else :size="15" /><span>{{ item.name }}</span><ChevronRight v-if="item.kind === 'directory'" :size="14" /></button>
        <small v-if="!tree.length">没有可展示的源码文件</small>
        <div class="tree-location"><button v-if="treeOffset" @click="browse(treePath, Math.max(0, treeOffset - 100))">上一页</button><button v-if="nextOffset !== null" @click="browse(treePath, nextOffset)">下一页</button></div>
      </div>
      <p class="privacy-note"><ShieldCheck :size="15" />本应用不保存此模式的代码、对话正文或补丁到云端数据库；所需片段会发给模型。本地会话仅在当前页面内存中，离开或刷新后清除。</p>
    </section>
    <p v-if="error" class="error-note" role="alert">{{ error }}</p>
    <section v-if="!turns.length" class="project-empty"><FolderOpen :size="30" /><h2>从了解项目开始</h2><p>连接目录后，可以让 AI 查找入口、解释代码或修改一个功能。</p><button :disabled="!workspace" @click="input = '查看这个项目的目录结构，按需读取关键文件，说明它的用途和入口。'">帮我了解这个项目</button><small>支持桌面 Chrome / Edge。依赖、构建产物和隐藏凭据会跳过。</small></section>
    <article v-for="(turn, index) in turns" :key="index" class="project-turn">
      <p class="user-message">{{ turn.question }}</p>
      <details :open="turn.open" class="process"><summary @click.prevent="turn.open = !turn.open">执行过程 · {{ turn.completed ? '已完成' : loading && index === turns.length - 1 ? '进行中' : '已停止' }}</summary>
        <div v-for="(activity, activityIndex) in turn.activities" :key="activityIndex" class="activity"><LoaderCircle v-if="activity.status === 'running'" :size="16" class="spin" /><X v-else-if="activity.status === 'error'" :size="16" /><Check v-else-if="activity.status === 'done'" :size="16" /><Square v-else :size="16" /><div><span>{{ activity.label }}</span><code v-if="activity.path">{{ activity.path }}</code><small v-if="activity.status === 'waiting'">等待你确认修改</small><p v-if="activity.detail">{{ activity.detail }}</p></div></div>
      </details>
      <LocalProjectText v-if="turn.answer" class="final-answer" :text="turn.answer" />
    </article>
    <section v-if="preview" class="change-card" aria-label="本地修改预览"><h2>{{ preview.hash === null ? '新建文件' : '确认修改' }} <code>{{ preview.path }}</code></h2><p>仅应用下面这项变更。若文件已变化，将停止写入。</p><div class="diff-grid"><div v-if="preview.hash !== null"><small>原内容</small><pre>{{ preview.oldText }}</pre></div><div><small>{{ preview.hash === null ? '文件内容' : '替换为' }}</small><pre>{{ preview.newText }}</pre></div></div><footer><button class="secondary" :disabled="applying" @click="rejectPreview">不修改</button><button class="connect-button" :disabled="applying" @click="applyPreview">{{ applying ? '正在授权…' : '应用到本地文件' }}</button></footer></section>
    <form class="local-composer" @submit.prevent="send"><label class="sr-only" for="local-question">项目任务</label><textarea id="local-question" v-model="input" :disabled="loading || !workspace" placeholder="描述你想了解或修改的内容…" rows="3" @keydown.enter.exact.prevent="!$event.isComposing && send()" /><footer><small>本地项目 · 按需读写</small><button v-if="loading" type="button" aria-label="停止任务" @click="stop"><Square :size="17" /></button><button v-else type="submit" :disabled="!canSend" aria-label="发送任务"><ArrowUp :size="19" /></button></footer></form>
    <div ref="bottom" />
  </main>
</template>

<style scoped>
.local-project{max-width:1050px;margin:0 auto;padding:24px 28px 40px;color:var(--foreground);min-width:0}.project-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.project-header h1{font-size:23px;margin:8px 0}.project-header p,.back-link{font-size:13px;color:var(--muted-foreground)}button{cursor:pointer;font:inherit}button:disabled{cursor:default;opacity:.5}button:focus-visible,a:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:3px}.secondary,.connect-button{border:1px solid var(--border);border-radius:10px;padding:10px 14px;background:var(--surface);white-space:nowrap}.connect-button{background:var(--primary);color:white;border-color:var(--primary)}.project-card{border:1px solid var(--border);border-radius:15px;background:var(--surface);padding:17px}.project-card.dragging{outline:2px dashed var(--primary)}.project-card-row{display:flex;gap:13px;align-items:center}.folder-icon{display:grid;place-items:center;flex-shrink:0;width:44px;height:44px;border-radius:12px;background:color-mix(in srgb,var(--primary) 9%,var(--surface));color:var(--primary)}.project-name{flex:1;min-width:0;text-align:left;border:0;background:none;color:inherit}.project-name strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.project-name small{display:block;font-size:12px;color:var(--muted-foreground);margin-top:5px}.icon-button{border:0;background:none;color:var(--muted-foreground)}.expanded{transform:rotate(90deg)}.privacy-note{display:flex;align-items:flex-start;gap:7px;font-size:12px;line-height:1.7;color:var(--muted-foreground);margin:15px 0 0}.privacy-note svg{flex-shrink:0;margin-top:3px}.project-tree{border-top:1px solid var(--border);margin-top:15px;padding-top:8px;max-height:320px;overflow:auto}.tree-location{display:flex;gap:12px;align-items:center;font-size:12px;color:var(--muted-foreground);padding:6px}.tree-location button{border:0;background:none;color:var(--primary)}.tree-file{display:flex;align-items:center;width:100%;gap:9px;padding:7px;border:0;border-radius:6px;background:none;color:var(--foreground);font-size:12px;text-align:left}.tree-file span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-file:disabled{opacity:1}.tree-file:not(:disabled):hover{background:var(--background)}.project-empty{padding:45px 12px;display:grid;justify-items:center;text-align:center;gap:8px;color:var(--muted-foreground)}.project-empty h2{font-size:20px;color:var(--foreground);margin:8px 0}.project-empty p{font-size:14px}.project-empty button{margin:10px 0;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:12px;color:var(--foreground)}.project-empty small{font-size:12px}.project-turn{padding:25px 0}.user-message{margin:0 0 25px auto;width:fit-content;max-width:88%;padding:12px 16px;border:1px solid color-mix(in srgb,var(--primary) 25%,var(--border));border-radius:13px;background:color-mix(in srgb,var(--primary) 6%,var(--surface));white-space:pre-wrap;overflow-wrap:anywhere}.process{font-size:13px;color:var(--muted-foreground)}.process summary{cursor:pointer;padding:8px 0}.activity{display:flex;gap:10px;padding:11px 0}.activity>svg{flex-shrink:0;margin-top:2px}.activity div{min-width:0}.activity code{display:inline-block;margin-left:9px;font-size:12px;overflow-wrap:anywhere}.activity small{display:block;margin-top:6px}.activity p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;margin:7px 0 0}.final-answer{line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;padding-top:18px}.error-note{padding:12px;border:1px solid var(--border);border-radius:10px;color:var(--danger);font-size:13px}.change-card{border:1px solid var(--primary);border-radius:14px;padding:18px;margin:20px 0;background:var(--surface)}.change-card h2{font-size:16px;margin:0}.change-card h2 code{font-size:13px;overflow-wrap:anywhere}.change-card p{font-size:13px;color:var(--muted-foreground)}.diff-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.diff-grid>div{min-width:0}.diff-grid small{font-size:12px;color:var(--muted-foreground)}.diff-grid pre{overflow:auto;max-height:280px;background:var(--background);padding:12px;border:1px solid var(--border);border-radius:8px;font-size:12px}.change-card footer{display:flex;justify-content:flex-end;gap:9px;margin-top:14px}.local-composer{margin-top:28px;border:1px solid var(--border);border-radius:15px;background:var(--surface);padding:13px}.local-composer textarea{width:100%;resize:vertical;border:0;background:none;color:var(--foreground);font:inherit;line-height:1.6;min-height:75px;max-height:220px}.local-composer footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.local-composer small{color:var(--muted-foreground);font-size:12px}.local-composer footer button{display:grid;place-items:center;border:0;background:var(--primary);color:white;width:34px;height:34px;border-radius:10px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}@media(max-width:640px){.local-project{padding:14px 12px 30px}.project-header{align-items:flex-start}.project-header .secondary{padding:8px;font-size:12px}.project-card{padding:12px}.project-card-row{gap:8px;flex-wrap:wrap}.project-name{min-width:120px}.connect-button{font-size:12px;padding:9px}.diff-grid{grid-template-columns:1fr}.project-empty{padding:30px 5px}}
</style>
