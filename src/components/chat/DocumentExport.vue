<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { CheckCircle2, ChevronDown, Download, FileText, FolderDown, LoaderCircle, X } from '@lucide/vue'
import AppButton from '@/components/ui/AppButton.vue'
import { canChooseDocumentLocation, createDocumentBlob, documentFilename, documentTitle, saveDocumentFile, type DocumentFormat } from '@/domain/document-export'

const props = withDefaults(defineProps<{ content: string; title?: string; expanded?: boolean; sourceLabel?: string; compact?: boolean; neutral?: boolean }>(), { title: '聊天整理', expanded: false, sourceLabel: '当前回复', compact: false, neutral: false })
const id = useId()
const open = ref(props.expanded)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const nameInput = ref<HTMLInputElement>()
const format = ref<DocumentFormat>('docx')
const filename = ref(documentFilename(documentTitle(props.content, props.title), format.value))
const blob = ref<Blob>()
const preparing = ref(false); const saving = ref(false)
const status = ref(''); const error = ref('')
const canChoose = canChooseDocumentLocation()
const exportTitle = computed(() => props.sourceLabel === '当前编辑草稿' ? props.title || '未命名文档' : documentTitle(props.content, props.title))
const chars = computed(() => props.content.replace(/\s/g, '').length.toLocaleString('zh-CN'))
let generation = 0
watch([() => props.content, exportTitle], () => { filename.value = documentFilename(exportTitle.value, format.value) })
watch(() => props.expanded, value => { open.value = value })
watch([open, format, () => props.content, exportTitle], async (_value, _previous, cleanup) => {
  const controller = new AbortController()
  cleanup(() => controller.abort())
  const current = ++generation; blob.value = undefined; status.value = ''; error.value = ''
  if (!open.value) { preparing.value = false; return }
  filename.value = documentFilename(filename.value, format.value)
  preparing.value = true
  try {
    const generated = await createDocumentBlob(props.content, format.value, exportTitle.value, controller.signal)
    if (current === generation) blob.value = generated
  } catch (exception) { if (current === generation) error.value = exception instanceof Error ? exception.message : '文件生成失败，请重试。' }
  finally { if (current === generation) preparing.value = false }
}, { immediate: true })
onBeforeUnmount(() => { generation++ })

function close() {
  if (saving.value) return
  open.value = false
  if (props.compact) void nextTick(() => trigger.value?.focus())
}
function clickOutside(event: PointerEvent) {
  if (props.compact && open.value && !saving.value && event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
watch(open, value => { if (value && props.compact) void nextTick(() => nameInput.value?.focus()) })
onMounted(() => document.addEventListener('pointerdown', clickOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', clickOutside))
defineExpose({ selectFormat(value: DocumentFormat) { format.value = value; open.value = true } })

async function save(downloadOnly = false) {
  if (!blob.value || saving.value) return
  const current = generation
  filename.value = documentFilename(filename.value, format.value)
  saving.value = true; error.value = ''; status.value = ''
  try {
    const result = await saveDocumentFile(blob.value, filename.value, format.value, downloadOnly ? { isSecureContext: false } : window)
    if (current !== generation) return
    status.value = result.status === 'saved' ? `已保存 ${result.name}` : result.status === 'cancelled' ? '已取消保存，文件未写入。' : '已发起下载，保存位置由浏览器的下载设置决定。'
  } catch (exception) {
    if (current === generation) error.value = exception instanceof Error && exception.name === 'NotAllowedError'
      ? '未获得保存权限，请重新选择允许写入的位置。' : '保存失败，文件未确认写入，请重新选择位置再试。'
  } finally { saving.value = false }
}
</script>

<template>
  <div ref="root" class="document-export" :class="{ 'document-export--compact': compact, 'document-export--neutral': neutral }" @keydown.esc.stop="close">
    <button v-if="compact || !open" ref="trigger" class="export-trigger" :class="{ 'export-trigger--primary': compact }" type="button" :aria-expanded="open" :aria-controls="`${id}-card`" @click="open ? close() : open = true"><Download :size="15" aria-hidden="true" />{{ compact ? '下载' : '保存为文件' }}<ChevronDown v-if="compact" :size="13" aria-hidden="true" /></button>
    <section v-if="open" :id="`${id}-card`" class="export-card" :aria-labelledby="`${id}-title`">
      <div class="export-heading">
        <span class="export-icon"><FileText :size="22" aria-hidden="true" /></span>
        <div><strong :id="`${id}-title`">保存这份整理</strong><span>{{ sourceLabel }} · {{ chars }} 字</span></div>
        <button class="export-close" :disabled="saving" type="button" aria-label="收起文件导出" @click="close"><X :size="17" aria-hidden="true" /></button>
      </div>
      <div class="export-fields">
        <label :for="`${id}-name`">文件名<input :id="`${id}-name`" ref="nameInput" v-model="filename" :disabled="saving" maxlength="110" @blur="filename = documentFilename(filename, format)" /></label>
        <label :for="`${id}-format`">格式<select :id="`${id}-format`" v-model="format" :disabled="saving"><option value="docx">Word (.docx)</option><option value="pdf">PDF (.pdf)</option><option value="xlsx">Excel (.xlsx)</option><option value="pptx">PowerPoint (.pptx)</option><option value="md">Markdown (.md)</option></select></label>
      </div>
      <p class="export-note">{{ canChoose ? '在系统窗口选择桌面或其它目录，确认后保存。' : '当前浏览器不支持选择目录，可下载后移动到指定位置。' }}<span v-if="format === 'pdf'">嵌入中文字体，按 A4 自动分页。图片保留说明与链接。</span><span v-if="format === 'docx' && /!\[/.test(content)">图片保留说明和链接。</span><span v-if="format === 'xlsx'">按竖线或制表符拆成单元格，内容作为文本，公式不执行。</span><span v-if="format === 'pptx'">按标题和正文分页生成文字幻灯片，不包含原动画和图表。</span></p>
      <div class="export-bottom">
        <p v-if="error" class="export-error" role="alert">{{ error }}</p>
        <p v-else class="export-status" role="status" aria-live="polite"><LoaderCircle v-if="preparing || saving" class="export-spinner" :size="14" aria-hidden="true" /><CheckCircle2 v-else-if="status.startsWith('已保存')" :size="15" aria-hidden="true" />{{ preparing ? '正在生成文件…' : saving ? '等待选择并保存…' : status || '文件已准备好' }}</p>
        <div class="export-actions"><AppButton v-if="canChoose" size="sm" variant="ghost" :disabled="!blob || preparing || saving" @click="save(true)"><Download :size="14" aria-hidden="true" />直接下载</AppButton><AppButton size="sm" :disabled="!blob || preparing" :loading="saving" @click="save()"><FolderDown v-if="canChoose" :size="15" aria-hidden="true" /><Download v-else :size="15" aria-hidden="true" />{{ canChoose ? '选择位置并保存' : '下载文件' }}</AppButton></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.document-export { width: 100%; min-width: 0; }
.document-export--compact{position:relative;width:auto;flex-shrink:0}
.document-export--compact .export-card{position:absolute;z-index:5;right:0;top:calc(100% + 10px);width:min(520px,calc(var(--workspace-pane-width,100vw) - 28px),calc(100vw - 28px));max-height:min(560px,calc(100dvh - 160px));overflow:auto;box-sizing:border-box;box-shadow:var(--shadow-popover);text-align:left}
.document-export--compact .export-trigger--primary{min-height:34px;padding:7px 12px;color:var(--primary-foreground,#fff);background:var(--primary);font-weight:600;font-size:13px;justify-content:center}
.document-export--compact .export-trigger--primary:hover{color:var(--primary-foreground,#fff);background:var(--primary-hover,var(--primary))}
.document-export--neutral .export-trigger--primary{min-height:30px;padding:5px 10px;border:1px solid var(--border);background:var(--surface);color:var(--foreground);font-size:12px;font-weight:500}
.document-export--neutral .export-trigger--primary:hover{background:var(--surface-muted);color:var(--foreground)}
.document-export--neutral .export-icon{background:var(--surface-muted);color:var(--foreground)}
.document-export--compact .export-fields{grid-template-columns:minmax(0,1fr) 145px}
@media(max-width:540px){.document-export--compact .export-fields{grid-template-columns:minmax(0,1fr)}.document-export--compact .export-card{max-height:calc(100dvh - 260px)}}
@media(max-width:1100px){.document-export--compact .export-card{width:min(520px,calc(100vw - 28px))}}
.export-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; background: transparent; border: 0; border-radius: 6px; color: var(--muted-foreground); font-size: 12px; }
.export-trigger:hover { color: var(--primary); background: var(--primary-soft); }
.export-card { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 16px; max-width: 680px; }
.export-heading { display: flex; gap: 10px; align-items: center; }
.export-icon { display: grid; place-items: center; width: 40px; height: 44px; border-radius: 9px; color: var(--primary); background: var(--primary-soft); flex-shrink: 0; }
.export-heading > div { display: grid; gap: 3px; min-width: 0; }
.export-heading strong { font-size: 14px; color: var(--foreground); }
.export-heading span:not(.export-icon) { font-size: 12px; color: var(--muted-foreground); }
.export-close { display: grid; place-items: center; margin-left: auto; width: 30px; height: 30px; border: 0; padding: 0; color: var(--muted-foreground); background: transparent; border-radius: 6px; }
.export-fields { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 12px; margin-top: 16px; }
.export-fields label { display: grid; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted-foreground); min-width: 0; }
.export-fields input,.export-fields select { min-width: 0; width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--foreground); font-size: 13px; height: 38px; box-sizing: border-box; }
.export-note { margin: 10px 0 14px; font-size: 12px; color: var(--muted-foreground); line-height: 1.7; }
.export-bottom { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.export-status,.export-error { display: flex; align-items: center; gap: 5px; margin: 0; min-width: 0; flex: 1; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.export-status { color: var(--muted-foreground); }.export-error { color: var(--danger); }
.export-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.export-spinner { animation: export-spin 1s linear infinite; flex-shrink: 0; }
.export-card button:focus-visible,.export-card input:focus-visible,.export-card select:focus-visible,.export-trigger:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
@keyframes export-spin { to { transform: rotate(360deg); } }
@media (max-width: 540px) { .export-card { padding: 14px; }.export-fields { grid-template-columns: minmax(0,1fr); }.export-bottom { align-items: flex-start; }.export-actions { width: 100%; flex-wrap: wrap; }.export-actions > button:last-child { flex: 1; }.export-status,.export-error { flex-basis: 100%; } }
@media (prefers-reduced-motion: reduce) { .export-spinner { animation: none; } }
</style>
