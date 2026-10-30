import { computed, onScopeDispose, reactive, ref, watch, type Ref } from 'vue'
import { extractWorkspaceDocument } from '@/api/local-workspace-documents'
import { documentName, MAX_WORKSPACE_DOCUMENT_BYTES } from '@/domain/local-workspace-documents'
import { applyDocumentReply, newDocumentDraft, type DocumentDraft, type DocumentTarget } from '@/domain/document-workspace'
import type { ChatAttachment } from '@/domain/chat-attachment'
import { attachmentContentUrl } from '@/domain/chat-attachment'
import { getAuthToken } from '@/auth'

export function useDocumentWorkspace(conversationId: Ref<string>, owner: Ref<string>) {
  const scopes = new Map<string, DocumentDraft[]>()
  const drafts = ref<DocumentDraft[]>([]); const activeId = ref(''); const open = ref(false)
  const busy = ref(false); const notice = ref(''); const error = ref(''); const reference = ref<DocumentTarget>()
  const replyTargets = reactive(new Map<string, DocumentTarget>())
  const active = computed(() => drafts.value.find(item => item.id === activeId.value))
  let readController: AbortController | undefined; let epoch = 0
  function abortRead() { epoch++; readController?.abort(); busy.value = false }
  watch(conversationId, (id, previous) => {
    abortRead(); reference.value = undefined; replyTargets.clear(); error.value = ''; notice.value = ''; open.value = false
    scopes.set(previous, drafts.value)
    drafts.value = scopes.get(id) || []; activeId.value = drafts.value[0]?.id || ''
  }, { flush: 'sync' })
  watch(owner, () => { abortRead(); scopes.clear(); drafts.value = []; replyTargets.clear(); activeId.value = ''; open.value = false; reference.value = undefined; error.value = ''; notice.value = '' }, { flush: 'sync' })
  onScopeDispose(abortRead)
  function add(content: string, title: string, source?: string, warnings?: string[]) {
    if (drafts.value.length >= 6) throw new Error('本对话已打开 6 份草稿，请下载后使用新对话继续。')
    const draft = newDocumentDraft(content, title.replace(/\.[a-z0-9]+$/i, ''), source, warnings)
    drafts.value.push(draft); activeId.value = draft.id; open.value = true; reference.value = undefined; error.value = ''
    return draft
  }
  function create() { try { add('', '未命名文档', '新建正文') } catch (exception) { error.value = (exception as Error).message } }
  function fromReply(content: string, title: string, key: string) {
    const existing = drafts.value.find(item => item.sourceId === key)
    if (existing) { activeId.value = existing.id; open.value = true; return }
    try { add(content, title, '聊天回复').sourceId = key } catch (exception) { error.value = (exception as Error).message; open.value = true }
  }
  async function read(file: File | ChatAttachment) {
    if (busy.value) return
    open.value = true; busy.value = true; error.value = ''; notice.value = ''; const current = ++epoch
    readController = new AbortController(); const controller = readController
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      if (!documentName(file.name) || !file.size || file.size > MAX_WORKSPACE_DOCUMENT_BYTES) throw new Error('支持 5 MB 内的 DOCX、XLSX、XLSM、XLS、PPTX 和 PDF。旧 DOC / PPT 请先转换。')
      let source: File
      if (file instanceof File) source = file
      else {
        const url = new URL(attachmentContentUrl(file.downloadUrl || file.previewUrl), window.location.origin)
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/chat/attachments/')) throw new Error('附件地址无法安全读取，请下载后使用“读取文件”。')
        const response = await fetch(url.href, { signal: controller.signal, cache: 'no-store', headers: { Authorization: `Bearer ${getAuthToken()}` } })
        if (!response.ok) throw new Error('无法读取此附件，请重新登录或重新上传。')
        const blob = await response.blob(); source = new File([blob], file.name, { type: blob.type })
      }
      const result = await extractWorkspaceDocument(source, controller.signal)
      if (current !== epoch) return
      if (!result.text.trim()) throw new Error('没有提取到正文；扫描 PDF 请先识别文字。')
      add(result.text, file.name, `读取 ${file.name}`, [...result.warnings, ...(result.truncated ? ['正文已达到解析上限，仅包含部分内容，请核对原文件。'] : [])])
      notice.value = result.truncated ? '已读取部分正文，请展开转换说明核对读取范围。' : '已读取正文。原文件保留，编辑与下载将生成新文件。'
    } catch (exception) { if (current === epoch) error.value = controller.signal.aborted ? '读取超时，请重试或缩小文件。' : (exception instanceof Error ? exception.message : '读取失败，请重试。') }
    finally { clearTimeout(timeout); if (current === epoch) busy.value = false }
  }
  function applyReply(content: string, key: string) {
    const target = replyTargets.get(key); const draft = drafts.value.find(item => item.id === target?.id)
    try {
      if (!target || !draft) throw new Error('本页未保留这次修改的目标，请将回复打开为新草稿。')
      applyDocumentReply(draft, target, content); activeId.value = draft.id; open.value = true; reference.value = undefined
      replyTargets.delete(key); notice.value = '已应用 AI 回复，修改前版本已保留。'; error.value = ''
    } catch (exception) { error.value = (exception as Error).message; open.value = true }
  }
  function promote(id: string) { if (!conversationId.value) { scopes.set(id, drafts.value); drafts.value = [] } }
  return { drafts, active, activeId, open, busy, notice, error, reference, replyTargets, add, create, fromReply, read, applyReply, promote }
}
