<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileText, X, Pencil, Eye, History, Undo2, Save, Printer, MessageSquare, Plus, Upload } from '@lucide/vue'
import AssistantMarkdown from './AssistantMarkdown.vue'
import DocumentExport from './DocumentExport.vue'
import { checkpoint, restoreVersion, updateDraft, type DocumentDraft, type DocumentTarget, documentTarget } from '@/domain/document-workspace'
import { renderAssistantMarkdown } from '@/domain/assistant-markdown'

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
function printPdf() {
  const d = draft.value; if (!d) return
  const popup = window.open('', '_blank', 'popup,width=900,height=850')
  if (!popup) { feedback.value = '打印窗口被拦截，请允许此站点打开弹窗后重试。'; return }
  popup.opener = null
  // Markdown renderer escapes file/model HTML; no remote images, fonts or scripts.
  const rendered = renderAssistantMarkdown(d.content).html
  popup.document.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>文档草稿</title><style>body{font:12pt/1.8 "Microsoft YaHei",sans-serif;color:#1e293b;max-width:180mm;margin:18mm auto;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:6px}pre{white-space:pre-wrap}button,.markdown-code-toolbar{display:none}@page{size:A4;margin:18mm}@media print{body{margin:0;max-width:none}h1,h2,h3{break-after:avoid}tr{break-inside:avoid}}</style></head><body>' + rendered + '</body></html>')
  popup.document.close(); popup.document.title = d.title; popup.focus(); popup.print()
  feedback.value = '请在打印窗口选择“另存为 PDF”；尚未确认文件保存。'
}
</script>

<template>
  <aside ref="panel" class="document-workspace-panel" aria-label="文档工作区" :role="mobile ? 'dialog' : undefined" :aria-modal="mobile ? true : undefined" tabindex="-1" @keydown="panelKey">
    <header class="doc-header">
      <span class="doc-icon"><FileText :size="21" aria-hidden="true" /></span>
      <div v-if="draft" class="doc-heading"><input aria-label="文档名称" maxlength="70" :value="draft.title" @input="edit(draft.content, ($event.target as HTMLInputElement).value)" /><small>正文草稿 · v{{ draft.versions[draft.versions.length - 1]?.number }}{{ changed ? ' · 有修改' : '' }}</small></div>
      <div v-else><strong>文档工作区</strong><small>与当前对话一起完成</small></div>
      <template v-if="draft"><button class="icon-button" type="button" :disabled="busy" aria-label="新建文档" title="新建文档" @click="emit('create')"><Plus :size="17" /></button><button class="icon-button" type="button" :disabled="busy" aria-label="读取文件" title="读取文件" @click="emit('import')"><Upload :size="17" /></button></template>
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
        <div class="doc-mode"><button :aria-pressed="!editing" type="button" @click="editing = false"><Eye :size="14" />预览</button><button :aria-pressed="editing" type="button" @click="startEdit"><Pencil :size="14" />编辑正文</button></div>
        <button type="button" :disabled="!undoCandidate" @click="undo"><Undo2 :size="14" />撤销</button>
        <button type="button" :aria-expanded="versions" @click="versions = !versions"><History :size="14" />版本</button>
        <button type="button" @click="save"><Save :size="14" />存版本</button>
      </div>
      <div v-if="versions" class="doc-versions"><strong>本页版本记录</strong><button v-for="version in [...draft.versions].reverse()" :key="version.number" type="button" @click="restore(version.number)">恢复 v{{ version.number }} · {{ version.label }}<small>{{ new Date(version.time).toLocaleTimeString() }}</small></button></div>
      <details class="doc-boundaries" :open="draft.warnings.length > 0"><summary>{{ draft.content.length.toLocaleString() }} 字 · 转换说明{{ draft.warnings.length ? '（请核对）' : '' }}</summary><p>读取文件会发送到解析服务。编辑提取出的正文，下载会生成新文件。原排版、图表、图片、公式及动画不保留；扫描 PDF 暂不支持识别。Excel 按分隔列生成，PPT 按标题分页。</p><p v-for="warning in draft.warnings" :key="warning">{{ warning }}</p></details>
      <div class="doc-paper-wrap">
        <textarea v-if="editing" ref="editor" class="doc-editor" aria-label="文档正文" maxlength="200000" spellcheck="false" :value="draft.content" placeholder="从这里开始书写，可使用 Markdown 标题、列表和表格。" @input="edit(($event.target as HTMLTextAreaElement).value)" />
        <article v-else class="doc-paper"><AssistantMarkdown v-if="draft.content" :text="draft.content" /><p v-else class="doc-empty">文档还是空白。点击“编辑正文”开始书写，或从聊天回复打开草稿。</p></article>
      </div>
      <footer class="doc-footer">
        <div class="doc-footer-actions"><button class="doc-reference" type="button" :disabled="!draft.content.trim()" @click="reference"><MessageSquare :size="14" />{{ editing ? '引用选区 / 全文提问' : '引用全文提问' }}</button><button type="button" :disabled="!draft.content.trim()" @click="printPdf"><Printer :size="14" />保存 PDF</button></div>
        <p v-if="feedback" class="doc-feedback" role="status">{{ feedback }}</p>
        <DocumentExport v-if="draft.content.trim()" :content="draft.content" :title="draft.title" source-label="当前编辑草稿" />
        <p class="doc-local-note">草稿与最近 20 个版本仅在本页保留，离开或刷新前请下载。</p>
      </footer>
    </template>
    <div v-else class="doc-empty-state"><FileText :size="36" /><h2>把文档放到对话旁</h2><p>读取 Word、Excel、PPT 或 PDF，<br />也可以从一份空白草稿开始。</p><button type="button" :disabled="busy" @click="emit('import')">读取文件</button><small>支持 DOCX、XLSX、XLSM、XLS、PPTX、PDF · 最大 5 MB</small></div>
  </aside>
</template>

<style scoped>
.document-workspace-panel{grid-column:2;grid-row:1 / 3;display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--border);border-radius:16px;background:var(--surface);overflow:hidden;box-shadow:0 6px 24px rgb(15 23 42 / 4%)}
.doc-header{display:flex;gap:10px;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border)}.doc-icon{color:var(--primary);background:var(--primary-soft);padding:9px;border-radius:10px}.doc-header>div{display:grid;gap:3px}.doc-header strong{font-size:15px}.doc-header small,.doc-local-note,.doc-feedback,.doc-boundaries,.doc-title-row>span{font-size:11px;color:var(--muted-foreground)}
.doc-heading{flex:1;min-width:0}.doc-heading input{min-width:0;width:100%;border:0;padding:0;background:transparent;color:var(--foreground);font-size:15px;font-weight:650}.doc-toolbar{margin-top:10px}.doc-footer .doc-local-note{margin:6px 0 0;font-size:10px}.doc-library>.muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc-header{padding-block:12px}.doc-header .icon-button{margin-left:0;flex-shrink:0}.doc-header>.icon-button:last-child{margin-left:auto}
.doc-boundaries{max-height:140px;overflow:auto;flex-shrink:0}
button{display:inline-flex;gap:5px;align-items:center;justify-content:center;min-height:32px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--foreground);padding:5px 9px;font-size:12px;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){background:var(--surface-muted)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.icon-button{margin-left:auto;border:0;padding:5px}
.doc-library{display:flex;gap:6px;align-items:center;padding:12px 16px 0}.doc-library select{flex:1;min-width:0;width:0;border:1px solid var(--border);border-radius:7px;padding:7px;background:var(--surface);color:var(--foreground);font-size:12px}.doc-library>.muted{flex:1;font-size:12px}.doc-local-note{margin:8px 16px;line-height:1.6}.doc-feedback{margin:7px 16px;line-height:1.7}.doc-error{color:var(--danger)}
.doc-title-row{display:flex;align-items:center;gap:8px;padding:10px 16px}.doc-title-row input{flex:1;min-width:0;padding:4px 0;border:0;background:transparent;color:var(--foreground);font-size:16px;font-weight:650}.doc-title-row>span{white-space:nowrap}.doc-toolbar{display:flex;gap:6px;align-items:center;padding:0 16px 10px;flex-wrap:wrap}.doc-mode{display:flex;margin-right:auto;gap:4px}.doc-mode button{border-color:transparent}.doc-mode [aria-pressed=true]{color:var(--primary);background:var(--primary-soft)}.doc-boundaries{margin:0 16px 10px;line-height:1.7}.doc-boundaries summary{cursor:pointer}.doc-boundaries p{margin:6px 0}.doc-versions{padding:10px 16px;max-height:180px;overflow:auto;display:grid;gap:5px;background:var(--surface-muted);font-size:12px}.doc-versions button{justify-content:space-between}.doc-versions small{color:var(--muted-foreground)}
.doc-paper-wrap{min-height:120px;flex:1;overflow:auto;background:var(--surface-muted);padding:20px}.doc-paper{min-height:100%;padding:28px 30px;background:var(--surface);border:1px solid var(--border);box-shadow:0 2px 8px rgb(15 23 42 / 4%)}.doc-editor{display:block;width:100%;min-height:100%;height:100%;resize:none;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--foreground);padding:24px;font:13px/1.9 "Microsoft YaHei",sans-serif;box-sizing:border-box}.doc-empty{font-size:13px;color:var(--muted-foreground)}.doc-footer{padding:12px 16px;border-top:1px solid var(--border);max-height:290px;overflow:auto}.doc-footer-actions{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap}.doc-reference{color:var(--primary);border-color:var(--primary-border);background:var(--primary-soft)}.doc-footer .doc-feedback{margin:7px 0}.doc-empty-state{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:30px 20px;text-align:center;color:var(--muted-foreground);gap:12px}.doc-empty-state h2{font-size:19px;color:var(--foreground);margin:0}.doc-empty-state p{font-size:13px;line-height:1.8;margin:0}.doc-empty-state small{font-size:11px;line-height:1.7}.doc-empty-state button{color:var(--primary);padding:8px 20px}
@media(max-width:1100px){.document-workspace-panel{position:fixed;inset:64px 8px 8px;z-index:80;border-radius:12px;box-shadow:0 12px 60px rgb(15 23 42 / 22%)}.doc-paper-wrap{padding:12px}.doc-paper{padding:22px}.doc-header{padding:10px 14px}.doc-local-note{font-size:10px}.doc-library button{font-size:11px}.doc-footer{max-height:260px}}
</style>
