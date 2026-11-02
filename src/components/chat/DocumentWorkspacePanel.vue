<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileText, X, Pencil, Eye, History, Undo2, Save, MessageSquare, Plus, Upload, Maximize2, Minimize2, Ellipsis } from '@lucide/vue'
import AssistantMarkdown from './AssistantMarkdown.vue'
import DocumentExport from './DocumentExport.vue'
import { checkpoint, restoreVersion, updateDraft, type DocumentDraft, type DocumentTarget, documentTarget } from '@/domain/document-workspace'

const props = defineProps<{ drafts: DocumentDraft[]; activeId: string; busy: boolean; notice: string; error: string; expanded?: boolean }>()
const emit = defineEmits<{ close: []; maximize: []; select: [id: string]; create: []; import: []; reference: [target: DocumentTarget] }>()
const draft = computed(() => props.drafts.find(item => item.id === props.activeId))
const editing = ref(false); const versions = ref(false); const feedback = ref(''); const editor = ref<HTMLTextAreaElement>()
const renaming = ref(false); const more = ref(false); const nameInput = ref<HTMLInputElement>(); const moreTrigger = ref<HTMLButtonElement>()
async function rename() { more.value = false; renaming.value = true; await nextTick(); nameInput.value?.focus(); nameInput.value?.select() }
const undoBefore = ref<number>()
watch(() => draft.value?.revision, () => { undoBefore.value = undefined }, { flush: 'sync' })
const panel = ref<HTMLElement>(); const mobile = ref(false)
let media: MediaQueryList | undefined; let previousFocus: HTMLElement | null = null
function closeMore() { more.value = false; void nextTick(() => moreTrigger.value?.focus()) }
function dismissMore(event: PointerEvent) { if (more.value && event.target instanceof Element && !event.target.closest('.doc-more')) more.value = false }
function mediaChanged() { mobile.value = Boolean(media?.matches) }
function panelKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && more.value) { event.preventDefault(); closeMore(); return }
  if (event.key === 'Escape' && renaming.value) { event.preventDefault(); renaming.value = false; void nextTick(() => panel.value?.focus()); return }
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (!mobile.value || event.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[tabindex="0"]')].filter(item => item.getClientRects().length > 0)
  const first = items[0]; const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => { document.addEventListener('pointerdown', dismissMore); previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; media = window.matchMedia('(max-width:1100px)'); mediaChanged(); media.addEventListener('change', mediaChanged); if (mobile.value) panel.value?.focus() })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', dismissMore); media?.removeEventListener('change', mediaChanged); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
watch(() => props.activeId, () => { versions.value = false; feedback.value = ''; editing.value = false; renaming.value = false; more.value = false })
const changed = computed(() => { const d = draft.value; const last = d?.versions[d.versions.length - 1]; return Boolean(d && last && (last.content !== d.content || last.title !== d.title)) })
const undoCandidate = computed(() => { const d = draft.value; if (!d) return undefined; return [...d.versions].reverse().find(version => (undoBefore.value === undefined || version.number < undoBefore.value) && (version.content !== d.content || version.title !== d.title)) })
function edit(content: string, title = draft.value?.title) { if (draft.value) { updateDraft(draft.value, content, title); feedback.value = '' } }
function save() { if (draft.value) feedback.value = checkpoint(draft.value) ? '已保存到本页版本记录。' : '当前内容已在版本记录中。' }
function restore(number: number) {
  const d = draft.value; const version = d?.versions.find(item => item.number === number)
  if (d && version) { restoreVersion(d, version); feedback.value = `已恢复 v${number}，恢复前内容也保留在版本记录中。`; versions.value = false }
}
function undo() {
  const version = undoCandidate.value
  if (version) { restore(version.number); undoBefore.value = version.number }
}
function reference() {
  const d = draft.value; if (!d || !d.content.trim()) return
  emit('reference', documentTarget(d, editing.value ? editor.value?.selectionStart : 0, editing.value ? editor.value?.selectionEnd : 0))
}
async function startEdit() { editing.value = true; await nextTick(); editor.value?.focus({ preventScroll: true }) }
</script>

<template>
  <aside ref="panel" class="document-workspace-panel" aria-label="文档工作区" :role="mobile ? 'dialog' : undefined" :aria-modal="mobile ? true : undefined" tabindex="-1" @keydown="panelKey">
    <header class="doc-header">
      <div class="doc-switcher"><slot name="switcher"><FileText :size="14" /><span>{{ draft?.title || '文档' }}</span></slot></div>
      <div class="doc-window-actions"><button class="icon-button" type="button" :disabled="busy" aria-label="新建文档" title="新建文档" @click="emit('create')"><Plus :size="16" /></button><button class="icon-button doc-maximize" type="button" :aria-pressed="expanded" :aria-label="expanded ? '退出专注文档' : '专注文档'" :title="expanded ? '退出专注文档' : '专注文档'" @click="emit('maximize')"><Minimize2 v-if="expanded" :size="15" /><Maximize2 v-else :size="15" /></button><button class="icon-button" type="button" aria-label="关闭文档工作区" title="关闭工作区" @click="emit('close')"><X :size="16" /></button></div>
    </header>
    <p v-if="!draft" class="doc-local-note">草稿与最近 20 个版本仅保留在当前页面，离开或刷新前请下载。读取文件会发送到解析服务。</p>
    <p v-if="busy || notice || error" :class="['doc-feedback', { 'doc-error': error }]" :role="error ? 'alert' : 'status'">{{ busy ? '正在读取文档正文…' : error || notice }}</p>
    <template v-if="draft">
      <div class="doc-toolbar">
        <div class="doc-mode"><button :aria-pressed="!editing" type="button" title="预览" @click="editing = false"><Eye :size="14" />预览</button><button :aria-pressed="editing" type="button" title="编辑正文" @click="startEdit"><Pencil :size="14" />编辑</button></div>
        <span class="doc-revision">v{{ draft.versions[draft.versions.length - 1]?.number }}{{ changed ? ' · 有修改' : '' }}</span>
        <button class="icon-button" type="button" :disabled="!undoCandidate" aria-label="撤销文档修改" title="撤销文档修改" @click="undo"><Undo2 :size="15" /></button>
        <button class="icon-button" type="button" :aria-expanded="versions" aria-label="版本记录" title="版本记录" @click="versions = !versions"><History :size="15" /><span v-if="changed" class="doc-unsaved" aria-label="有未存版本的修改" /></button>
        <div class="doc-more"><button ref="moreTrigger" class="icon-button" type="button" :aria-expanded="more" aria-label="文档更多操作" title="更多操作" @click="more = !more"><Ellipsis :size="17" /></button><div v-if="more" class="doc-more-menu" @keydown.esc.stop="closeMore"><button type="button" @click="rename"><Pencil :size="14" />重命名文档</button><button type="button" :disabled="busy" @click="more = false; emit('import')"><Upload :size="14" />读取文件</button><button type="button" @click="save(); more = false"><Save :size="14" />保存当前版本</button></div></div>
        <DocumentExport v-if="draft.content.trim()" compact neutral :content="draft.content" :title="draft.title" source-label="当前编辑草稿" />
      </div>
      <div v-if="renaming" class="doc-rename"><label>文档名称<input ref="nameInput" aria-label="文档名称" maxlength="70" :value="draft.title" @input="edit(draft.content, ($event.target as HTMLInputElement).value)" @keydown.enter.prevent="renaming = false" /></label><button type="button" @click="renaming = false">完成</button></div>
      <div v-if="versions" class="doc-versions"><div class="doc-versions-heading"><strong>本页版本记录</strong><button type="button" @click="save"><Save :size="14" />保存当前版本</button></div><button v-for="version in [...draft.versions].reverse()" :key="version.number" type="button" @click="restore(version.number)">恢复 v{{ version.number }} · {{ version.label }}<small>{{ new Date(version.time).toLocaleTimeString() }}</small></button></div>
      <div class="doc-paper-wrap">
        <textarea v-if="editing" ref="editor" class="doc-editor" aria-label="文档正文" maxlength="200000" spellcheck="false" :value="draft.content" placeholder="从这里开始书写，可使用 Markdown 标题、列表和表格。" @input="edit(($event.target as HTMLTextAreaElement).value)" />
        <article v-else class="doc-paper"><AssistantMarkdown v-if="draft.content" :text="draft.content" /><p v-else class="doc-empty">文档还是空白。点击“编辑正文”开始书写，或从聊天回复打开草稿。</p></article>
      </div>
      <footer class="doc-footer">
        <div class="doc-footer-actions"><details class="doc-boundaries" :open="draft.warnings.length > 0"><summary>{{ draft.content.length.toLocaleString() }} 字 · 仅本页保留{{ draft.warnings.length ? ' · 转换提醒' : '' }}</summary><div class="doc-boundary-content"><p>草稿与最近 20 个版本仅在本页保留，离开或刷新前请下载。</p><p>读取文件会发送到解析服务。编辑提取出的正文，下载会生成新文件。原排版、图表、图片、公式及动画不保留；扫描 PDF 暂不支持识别。Excel 按分隔列生成，PPT 按标题分页。</p><p v-for="warning in draft.warnings" :key="warning">{{ warning }}</p></div></details><button class="doc-reference" type="button" :disabled="!draft.content.trim()" @click="reference"><MessageSquare :size="14" />{{ editing ? '引用选区 / 全文提问' : '引用全文提问' }}</button></div>
        <p v-if="feedback" class="doc-feedback" role="status">{{ feedback }}</p>
      </footer>
    </template>
    <div v-else class="doc-empty-state"><FileText :size="36" /><h2>把文档放到对话旁</h2><p>读取 Word、Excel、PPT 或 PDF，<br />也可以从一份空白草稿开始。</p><button type="button" :disabled="busy" @click="emit('import')">读取文件</button><small>支持 DOCX、XLSX、XLSM、XLS、PPTX、PDF · 最大 5 MB</small></div>
  </aside>
</template>

<style scoped>
.document-workspace-panel{--workspace-muted:color-mix(in srgb,var(--foreground) 3%,var(--surface));grid-column:2;grid-row:1 / 3;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--surface);border-left:1px solid var(--border);isolation:isolate}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--foreground);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
button:hover:not(:disabled){background:var(--workspace-muted)}button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
.doc-header{display:flex;align-items:center;min-height:44px;max-height:44px;border-bottom:1px solid var(--border);background:var(--workspace-muted);flex-shrink:0;padding:0 7px 0 0;gap:4px}
.doc-switcher{display:flex;align-items:center;min-width:0;flex:1;height:44px;overflow:hidden}.doc-switcher>span{font-size:12px;margin-left:7px}
.doc-window-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}.icon-button{position:relative;min-width:30px;padding:5px;color:var(--muted-foreground);flex-shrink:0}.icon-button:hover{color:var(--foreground)}
.doc-toolbar{position:relative;z-index:3;display:flex;align-items:center;gap:4px;min-height:46px;padding:6px 14px;box-sizing:border-box;border-bottom:1px solid color-mix(in srgb,var(--border) 65%,transparent);flex-shrink:0}
.doc-mode{display:flex;align-items:center;gap:2px}.doc-mode button{color:var(--muted-foreground)}.doc-mode [aria-pressed=true]{background:var(--workspace-muted);color:var(--foreground)}
.doc-revision{font-size:11px;color:var(--muted-foreground);margin-left:8px;margin-right:auto;white-space:nowrap}.doc-unsaved{position:absolute;top:4px;right:3px;width:4px;height:4px;border-radius:50%;background:var(--foreground)}
.doc-more{position:relative}.doc-more-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:6;display:grid;min-width:155px;padding:5px;border:1px solid var(--border);border-radius:9px;background:var(--surface);box-shadow:var(--shadow-popover)}.doc-more-menu button{justify-content:flex-start;padding:8px 10px}
.doc-rename{display:flex;align-items:end;gap:8px;padding:12px 18px;border-bottom:1px solid var(--border);flex-shrink:0}.doc-rename label{min-width:0;display:grid;gap:5px;flex:1;font-size:11px;color:var(--muted-foreground)}.doc-rename input{width:100%;min-width:0;border:1px solid var(--border);border-radius:6px;padding:7px;background:var(--surface);color:var(--foreground);font-size:13px}
.doc-versions{padding:14px 18px;max-height:220px;overflow:auto;display:grid;gap:5px;border-bottom:1px solid var(--border);flex-shrink:0;font-size:12px;background:var(--surface)}.doc-versions-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px}.doc-versions>button{justify-content:space-between}.doc-versions small{color:var(--muted-foreground)}
.doc-paper-wrap{min-height:100px;flex:1;overflow:auto;overscroll-behavior:contain;background:var(--surface);scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent;padding:0}
.doc-paper{width:100%;max-width:850px;min-height:100%;box-sizing:border-box;margin-inline:auto;padding:42px 48px 70px;background:transparent;border:0;box-shadow:none}
.doc-paper :deep(.assistant-markdown){font-size:14px;line-height:1.9}.doc-paper :deep(.assistant-markdown h1){margin:0 0 28px;font-size:25px;line-height:1.45;letter-spacing:-.025em}.doc-paper :deep(.assistant-markdown h2){font-size:18px;line-height:1.6;margin:28px 0 14px}.doc-paper :deep(.assistant-markdown h3){font-size:16px}.doc-paper :deep(.markdown-table-wrap){border-radius:6px}.doc-paper :deep(th){background:var(--workspace-muted)}
.doc-editor{display:block;width:100%;max-width:850px;min-height:100%;height:100%;resize:none;box-sizing:border-box;margin-inline:auto;border:0;border-radius:0;padding:36px 48px 60px;background:var(--surface);color:var(--foreground);font:14px/1.9 ui-monospace,Consolas,'Microsoft YaHei',monospace}
.doc-footer{position:relative;z-index:2;flex-shrink:0;padding:5px 14px;border-top:1px solid color-mix(in srgb,var(--border) 65%,transparent);background:var(--surface)}.doc-footer-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px}.doc-reference{color:var(--muted-foreground);font-size:11px;padding:4px 6px}.doc-reference:hover{color:var(--foreground)}
.doc-boundaries{font-size:10px;color:var(--muted-foreground);min-width:0;line-height:1.6}.doc-boundaries summary{list-style:none;cursor:pointer}.doc-boundary-content{position:absolute;left:10px;right:10px;bottom:calc(100% + 6px);max-height:220px;overflow:auto;padding:12px 14px;border:1px solid var(--border);border-radius:9px;background:var(--surface);box-shadow:var(--shadow-popover);font-size:12px;line-height:1.7}.doc-boundary-content p{margin:5px 0}
.doc-local-note,.doc-feedback{flex-shrink:0;font-size:11px;line-height:1.7;color:var(--muted-foreground);margin:8px 16px}.doc-footer .doc-feedback{margin:4px 0}.doc-error{color:var(--danger)}
.doc-empty-state{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:30px 24px;gap:14px;text-align:center;color:var(--muted-foreground)}.doc-empty-state h2{font-size:20px;letter-spacing:-.02em;color:var(--foreground);margin:0}.doc-empty-state p{font-size:13px;line-height:1.9;margin:0}.doc-empty-state small{font-size:11px;line-height:1.8}.doc-empty-state button{border:1px solid var(--border);padding:7px 16px}.doc-empty{color:var(--muted-foreground);font-size:13px}
@media(max-width:1440px){.doc-paper{padding:34px 32px 60px}.doc-editor{padding-inline:32px}.doc-toolbar{padding-inline:10px}}
@media(max-width:1100px){.document-workspace-panel{position:fixed;inset:64px 0 0;z-index:80;border:0;border-top:1px solid var(--border)}.doc-maximize{display:none}.doc-paper{padding:30px 26px 50px}.doc-editor{padding:26px}.doc-header{padding-right:6px}.doc-paper :deep(.assistant-markdown h1){font-size:24px}}
@media(max-width:540px){.doc-toolbar{padding-inline:9px;gap:2px}.doc-revision{margin-left:4px;font-size:10px}.doc-mode button{padding-inline:7px;font-size:11px}.doc-paper{padding:28px 22px 45px}.doc-editor{padding-inline:22px}.doc-footer{padding-inline:10px}.doc-reference{font-size:10px;gap:4px}.doc-window-actions{gap:0}.doc-window-actions .icon-button{min-width:27px}.doc-versions-heading{align-items:start}.doc-versions-heading button{font-size:11px}}
@media(max-width:360px){.doc-revision{display:none}.doc-mode{margin-right:auto}.doc-mode button{gap:4px;padding-inline:6px}.doc-toolbar .icon-button{min-width:26px}.doc-reference>svg{display:none}}
</style>
