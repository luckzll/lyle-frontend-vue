<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileText, X, Pencil, Eye, History, Undo2, Save, MessageSquare, Plus, Upload } from '@lucide/vue'
import AssistantMarkdown from './AssistantMarkdown.vue'
import DocumentExport from './DocumentExport.vue'
import { checkpoint, restoreVersion, updateDraft, type DocumentDraft, type DocumentTarget, documentTarget } from '@/domain/document-workspace'

const props = defineProps<{ drafts: DocumentDraft[]; activeId: string; busy: boolean; notice: string; error: string }>()
const emit = defineEmits<{ close: []; select: [id: string]; create: []; import: []; reference: [target: DocumentTarget] }>()
const draft = computed(() => props.drafts.find(item => item.id === props.activeId))
const editing = ref(false); const versions = ref(false); const feedback = ref(''); const editor = ref<HTMLTextAreaElement>()
const undoBefore = ref<number>()
watch(() => draft.value?.revision, () => { undoBefore.value = undefined }, { flush: 'sync' })
const panel = ref<HTMLElement>(); const mobile = ref(false)
let media: MediaQueryList | undefined; let previousFocus: HTMLElement | null = null
function mediaChanged() { mobile.value = Boolean(media?.matches) }
function panelKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (!mobile.value || event.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[tabindex="0"]')].filter(item => item.getClientRects().length > 0)
  const first = items[0]; const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; media = window.matchMedia('(max-width:1100px)'); mediaChanged(); media.addEventListener('change', mediaChanged); if (mobile.value) panel.value?.focus() })
onBeforeUnmount(() => { media?.removeEventListener('change', mediaChanged); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
watch(() => props.activeId, () => { versions.value = false; feedback.value = ''; editing.value = false })
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
      <span class="doc-icon"><FileText :size="21" aria-hidden="true" /></span>
      <div v-if="draft" class="doc-heading"><input aria-label="文档名称" maxlength="70" :value="draft.title" @input="edit(draft.content, ($event.target as HTMLInputElement).value)" /><small>正文草稿 · v{{ draft.versions[draft.versions.length - 1]?.number }}{{ changed ? ' · 有修改' : '' }}</small></div>
      <div v-else><strong>文档工作区</strong><small>与当前对话一起完成</small></div>
      <div class="doc-switcher"><slot name="switcher" /></div>
      <div v-if="draft" class="doc-header-file-actions"><button class="icon-button" type="button" :disabled="busy" aria-label="新建文档" title="新建文档" @click="emit('create')"><Plus :size="16" /></button><button class="icon-button" type="button" :disabled="busy" aria-label="读取文件" title="读取文件" @click="emit('import')"><Upload :size="16" /></button></div>
      <button class="icon-button" type="button" aria-label="关闭文档工作区" @click="emit('close')"><X :size="18" /></button>
    </header>
    <div v-if="!draft || drafts.length > 1" class="doc-library">
      <select v-if="drafts.length > 1" aria-label="当前文档" :value="activeId" @change="emit('select', ($event.target as HTMLSelectElement).value)"><option v-for="item in drafts" :key="item.id" :value="item.id">{{ item.title || '未命名文档' }}</option></select>
      <span v-else class="muted">{{ draft?.source || '本对话的文档' }}</span>
      <button v-if="!draft" type="button" :disabled="busy" @click="emit('create')"><Plus :size="14" />新建</button>
      <button v-if="!draft" type="button" :disabled="busy" @click="emit('import')"><Upload :size="14" />读取文件</button>
    </div>
    <p v-if="!draft" class="doc-local-note">草稿与最近 20 个版本仅保留在当前页面，离开或刷新前请下载。读取文件会发送到解析服务。</p>
    <p v-if="busy || notice || error" :class="['doc-feedback', { 'doc-error': error }]" :role="error ? 'alert' : 'status'">{{ busy ? '正在读取文档正文…' : error || notice }}</p>
    <template v-if="draft">
      <div class="doc-toolbar">
        <div class="doc-mode"><button :aria-pressed="!editing" type="button" title="预览" @click="editing = false"><Eye :size="14" />预览</button><button :aria-pressed="editing" type="button" title="编辑正文" @click="startEdit"><Pencil :size="14" />编辑正文</button></div>
        <div class="doc-file-actions"><button class="icon-button" type="button" :disabled="busy" aria-label="新建文档" title="新建文档" @click="emit('create')"><Plus :size="16" /></button><button class="icon-button" type="button" :disabled="busy" aria-label="读取文件" title="读取文件" @click="emit('import')"><Upload :size="16" /></button></div>
        <button class="icon-button" type="button" :disabled="!undoCandidate" aria-label="撤销文档修改" title="撤销文档修改" @click="undo"><Undo2 :size="15" /></button>
        <button class="doc-history-button" type="button" :aria-expanded="versions" @click="versions = !versions"><History :size="14" />版本<span v-if="changed" class="doc-unsaved" aria-label="有未存版本的修改" /></button>
        <DocumentExport v-if="draft.content.trim()" compact :content="draft.content" :title="draft.title" source-label="当前编辑草稿" />
      </div>
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
.document-workspace-panel{grid-column:2;grid-row:1 / 3;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.doc-header{display:flex;align-items:center;border-bottom:1px solid var(--border)}
.doc-header>div{display:grid;gap:3px}.doc-heading{flex:1;min-width:0}
.doc-heading input{min-width:0;width:100%;border:0;padding:0;background:transparent;color:var(--foreground);font-weight:650}
.doc-header small,.doc-local-note,.doc-feedback{color:var(--muted-foreground);font-size:11px}
.doc-icon{color:var(--primary);background:var(--primary-soft)}
button{display:inline-flex;gap:5px;align-items:center;justify-content:center;min-height:32px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--foreground);padding:5px 9px;font-size:12px;cursor:pointer}
button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){background:var(--surface-muted)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.icon-button{border:0;padding:5px;flex-shrink:0}
.doc-library{display:flex;gap:6px;align-items:center;padding:12px 16px}
.doc-library select{flex:1;min-width:0;width:0;border:1px solid var(--border);border-radius:7px;padding:7px;background:var(--surface);color:var(--foreground);font-size:12px}
.doc-library>.muted{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc-local-note{margin:8px 16px;line-height:1.6}.doc-feedback{margin:7px 16px;line-height:1.7}.doc-error{color:var(--danger)}
.doc-toolbar{display:flex;align-items:center}.doc-mode{display:flex;margin-right:auto}.doc-mode button{border-color:transparent}
.doc-versions{display:grid;gap:5px;overflow:auto;font-size:12px}.doc-versions button{justify-content:space-between}.doc-versions small{color:var(--muted-foreground)}
.doc-paper-wrap{min-height:120px;flex:1;overflow:auto}.doc-paper{background:var(--surface)}
.doc-editor{display:block;width:100%;min-height:100%;height:100%;resize:none;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--foreground);font-family:inherit;box-sizing:border-box}
.doc-empty{font-size:13px;color:var(--muted-foreground)}
.doc-footer{border-top:1px solid var(--border)}.doc-footer-actions{display:flex;justify-content:space-between}.doc-reference{color:var(--primary)}.doc-footer .doc-feedback{margin:7px 0}
.doc-boundaries p{margin:6px 0}
.doc-empty-state{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:30px 20px;text-align:center;color:var(--muted-foreground);gap:12px}
.doc-empty-state h2{font-size:19px;color:var(--foreground);margin:0}.doc-empty-state p{font-size:13px;line-height:1.8;margin:0}.doc-empty-state small{font-size:11px;line-height:1.7}.doc-empty-state button{color:var(--primary);padding:8px 20px}
@media(max-width:1100px){.document-workspace-panel{position:fixed;z-index:80}}

/* A single docked surface keeps the document, tools and status in one hierarchy. */
.document-workspace-panel{border:0;border-left:1px solid var(--border);border-radius:0;box-shadow:none;background:var(--surface);isolation:isolate}
.doc-header{min-height:72px;padding:12px 18px;gap:10px;flex-shrink:0;box-sizing:border-box}
.doc-icon{display:grid;place-items:center;padding:8px;border-radius:8px;flex-shrink:0}
.doc-header>.doc-switcher{display:block;flex-shrink:0;margin-left:auto}
.doc-header>.icon-button:last-child{margin-left:0;color:var(--muted-foreground)}
.doc-heading input{font-size:16px;line-height:1.6}.doc-header small{font-size:12px;line-height:1.5}
.doc-toolbar{position:relative;z-index:3;flex-shrink:0;margin:0;gap:7px;min-height:64px;box-sizing:border-box;padding:9px 18px;border-bottom:1px solid var(--border);flex-wrap:nowrap}
.doc-mode{gap:4px}.doc-mode button{min-height:34px;padding:6px 10px;white-space:nowrap;font-size:14px}.doc-mode [aria-pressed=true]{background:var(--primary);color:var(--primary-foreground,#fff)}
.doc-file-actions{display:flex;align-items:center;gap:2px;border-right:1px solid var(--border);padding-right:6px}
.doc-toolbar .icon-button{margin:0;min-width:30px;color:var(--muted-foreground)}
.doc-history-button{border-color:var(--border);min-height:34px;position:relative;white-space:nowrap;font-size:13px}
.doc-unsaved{width:5px;height:5px;border-radius:50%;background:var(--primary)}
.doc-versions{flex-shrink:0;border-bottom:1px solid var(--border);padding:12px 18px;background:var(--surface);max-height:210px}
.doc-versions-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}
.doc-paper-wrap{padding:16px 24px;background:var(--surface-muted);overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
.doc-paper{max-width:900px;min-height:100%;box-sizing:border-box;margin-inline:auto;padding:32px 42px;border:1px solid var(--border);box-shadow:0 2px 5px rgb(15 23 42 / 3%)}
.doc-paper :deep(.assistant-markdown){font-size:15px;line-height:1.9}.doc-paper :deep(.assistant-markdown h1){font-size:30px;line-height:1.4;margin:0 0 24px}.doc-paper :deep(.assistant-markdown h2){font-size:21px;line-height:1.5;margin:26px 0 14px}.doc-paper :deep(.assistant-markdown h3){font-size:17px}.doc-paper :deep(.assistant-markdown th),.doc-paper :deep(.assistant-markdown td){padding-block:12px}
.doc-editor{max-width:900px;margin-inline:auto;padding:32px 38px;border-color:var(--border);font-size:14px;line-height:1.9}
.doc-footer{position:relative;z-index:2;flex-shrink:0;max-height:160px;padding:8px 18px;overflow:visible;background:var(--surface)}
.doc-footer-actions{margin:0;align-items:center;flex-wrap:nowrap;gap:10px;min-height:28px}
.doc-reference{padding:4px 6px;border:0;background:transparent;font-size:11px;white-space:nowrap}
.doc-boundaries{margin:0;max-height:none;font-size:10px;overflow:visible;line-height:1.6;min-width:0}
.doc-boundaries summary{list-style:none;cursor:pointer;color:var(--muted-foreground)}.doc-boundaries summary:hover{color:var(--foreground)}
.doc-boundary-content{position:absolute;bottom:calc(100% + 8px);left:12px;right:12px;max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:var(--surface);box-shadow:var(--shadow-popover);font-size:12px;line-height:1.7}
.doc-feedback{flex-shrink:0}
.doc-header>.doc-header-file-actions{display:none}
@media(min-width:1101px) and (max-width:1440px){.doc-header{padding-inline:14px}.doc-header>.doc-icon{display:none}.doc-heading input{font-size:13px}.doc-toolbar{padding-inline:12px;gap:5px}.doc-file-actions{display:none}.doc-paper-wrap{padding:16px}.doc-paper{padding:28px}.doc-mode button{padding-inline:8px}}
@media(max-width:1100px){.document-workspace-panel{inset:64px 8px 8px;border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-dialog)}.doc-header{flex-wrap:wrap;padding:12px;gap:8px}.doc-heading{flex-basis:calc(100% - 92px)}.doc-header>.doc-switcher{order:2;margin-left:0}.doc-toolbar{padding:8px 12px;gap:5px;min-height:54px}.doc-paper-wrap{padding:14px}.doc-paper{padding:28px}.doc-footer{padding-inline:12px}.doc-file-actions{margin-right:0}.doc-paper :deep(.assistant-markdown h1){font-size:23px}}
@media(max-width:540px){.doc-file-actions{display:none}.doc-toolbar .doc-mode{gap:0}.doc-mode button{padding-inline:7px;font-size:11px}.doc-history-button{padding-inline:7px;font-size:11px}.doc-toolbar{gap:4px}.doc-toolbar .icon-button{min-width:25px;padding:4px}.doc-paper-wrap{padding:10px}.doc-paper{padding:22px 18px}.doc-editor{padding:20px 18px}.doc-footer-actions{gap:4px}.doc-reference{font-size:10px;gap:4px}}
@media(max-width:1440px){.doc-header>.doc-header-file-actions{display:flex;gap:3px;align-items:center;order:2;margin-left:auto}.doc-header .doc-header-file-actions .icon-button{min-width:29px;margin:0}.doc-header{flex-wrap:wrap}.doc-heading{flex-basis:calc(100% - 80px)}.doc-header>.doc-switcher{order:2;margin-left:0}.doc-header>.icon-button:last-child{margin-left:auto}.doc-toolbar>.doc-file-actions{display:none}}
@media(max-width:1440px){.doc-header{display:grid;grid-template-columns:36px minmax(0,1fr) 66px;gap:8px}.doc-header>.doc-icon{display:grid;grid-column:1;grid-row:1}.doc-header>.doc-heading{grid-column:2;grid-row:1;min-width:0}.doc-header>.icon-button:last-child{grid-column:3;grid-row:1;justify-self:end;margin:0}.doc-header>.doc-switcher{grid-column:1 / 3;grid-row:2;justify-self:start}.doc-header>.doc-header-file-actions{grid-column:3;grid-row:2;margin:0;justify-self:end}}
@media(max-width:540px){.doc-paper :deep(.assistant-markdown){font-size:14px}.doc-paper :deep(.assistant-markdown h2){font-size:18px}}
@media(max-width:360px){.doc-mode button{min-width:32px;gap:0;font-size:0;padding:7px}.doc-history-button{padding-inline:6px}.doc-toolbar .icon-button{min-width:26px}}
</style>
