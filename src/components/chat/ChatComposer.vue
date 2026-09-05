<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ArrowUp, ChevronDown, Layers3, Plus, Sparkles, Square, X } from '@lucide/vue'
import AttachmentCommandMenu from './AttachmentCommandMenu.vue'
import AttachmentSkipSummary from './AttachmentSkipSummary.vue'
import AttachmentTray from './AttachmentTray.vue'
import type { ChatAttachmentDraft } from '@/domain/chat-attachment'
import type { DirectorySkip } from '@/domain/directory-entry'
import type { ChatModelId, ChatModelOption } from '@/domain/chat-model'

const props = defineProps<{
  modelValue: string
  attachments: ChatAttachmentDraft[]
  skipped: DirectorySkip[]
  loading: boolean
  disabled: boolean
  announcement?: string
  showAttachmentHint?: boolean
  folderAttachmentsEnabled?: boolean
  chatModelId: ChatModelId
  modelOptions: readonly ChatModelOption[]
  contextSummary: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  stop: []
  files: [files: File[], source: 'picker' | 'paste' | 'folder_picker']
  remove: [localId: string]
  retry: [localId: string]
  dismissHint: []
  'update:chatModelId': [value: ChatModelId]
  'open-context': []
}>()

const root = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const attachmentTrigger = ref<HTMLButtonElement>()
const attachmentMenu = ref<{ focusEdge: (last?: boolean) => void; containsTarget: (target: Node) => boolean }>()
const attachmentOpen = ref(false)
const slashDismissed = ref(false)
const menuId = `composer-attachments-${useId()}`
const inputHelpId = `composer-help-${useId()}`
const composing = ref(false)
const browserFolderSupported = ref(false)
const folderSupported = computed(() => browserFolderSupported.value && props.folderAttachmentsEnabled !== false)
const mobile = ref(false)
let mobileQuery: MediaQueryList | undefined
const slashCommand = computed(() => /^\s*\/[\p{L}]*$/u.test(props.modelValue))
const commandOpen = computed(() => attachmentOpen.value || (slashCommand.value && !slashDismissed.value))
const selectedModel = computed(() => (
  props.modelOptions.find((option) => option.id === props.chatModelId) || props.modelOptions[0]
))

function resize() {
  const element = textarea.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, matchMedia('(max-width: 640px)').matches ? 180 : 240)}px`
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  if (commandOpen.value && event.key === 'Escape') {
    event.preventDefault()
    dismissMenu()
    return
  }
  if (commandOpen.value && !event.shiftKey && ['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    attachmentMenu.value?.focusEdge(event.key === 'ArrowUp')
    return
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (!props.disabled && !props.loading) emit('submit')
}

function paste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items || []).flatMap((item) => {
    const file = item.kind === 'file' ? item.getAsFile() : null
    return file ? [file] : []
  })
  if (files.length) emit('files', files, 'paste')
}

function choose(command: 'image' | 'file' | 'folder') {
  attachmentOpen.value = false
  slashDismissed.value = true
  emit('update:modelValue', props.modelValue.replace(/^\s*\/[\p{L}]*$/u, ''))
  const input = command === 'image' ? imageInput.value : command === 'folder' ? folderInput.value : fileInput.value
  input?.click()
}

function dismissMenu(restoreFocus = true) {
  const fromButton = attachmentOpen.value
  attachmentOpen.value = false
  slashDismissed.value = true
  if (restoreFocus) void nextTick(() => (fromButton ? attachmentTrigger.value : textarea.value)?.focus({ preventScroll: true }))
}

async function toggleAttachments() {
  if (commandOpen.value) {
    dismissMenu()
    return
  }
  attachmentOpen.value = true
  await nextTick()
  attachmentMenu.value?.focusEdge()
}

function outsidePointer(event: PointerEvent) {
  dismissOutsideMenu(event.target as Node | null)
}

function focusOut(event: FocusEvent) {
  dismissOutsideMenu(event.relatedTarget as Node | null)
}

function dismissOutsideMenu(target: Node | null) {
  if (!commandOpen.value || !target) return
  if (attachmentTrigger.value?.contains(target) || attachmentMenu.value?.containsTarget(target)) return
  // Typing a slash command keeps its suggestions open; returning to a normal
  // draft from the attachment button must restore normal Enter-to-send behavior.
  if (!attachmentOpen.value && textarea.value?.contains(target)) return
  dismissMenu(false)
}

function selected(event: Event, source: 'picker' | 'folder_picker') {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length) emit('files', files, source)
  input.value = ''
  void nextTick(() => textarea.value?.focus())
}

function selectModel(event: Event) {
  emit('update:chatModelId', (event.target as HTMLSelectElement).value as ChatModelId)
}

function shortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'o') return
  const active = document.activeElement as HTMLElement | null
  if (!active?.closest('.chat-composer, .chat-workspace')) return
  if (event.shiftKey && !folderSupported.value) return
  event.preventDefault()
  choose(event.shiftKey ? 'folder' : 'file')
}

function syncMobile() {
  mobile.value = Boolean(mobileQuery?.matches)
}

watch(() => props.modelValue, () => {
  slashDismissed.value = false
  void nextTick(resize)
})
onMounted(() => {
  resize()
  const probe = document.createElement('input')
  browserFolderSupported.value = 'webkitdirectory' in probe
  mobileQuery = window.matchMedia('(max-width: 640px)')
  syncMobile()
  mobileQuery.addEventListener('change', syncMobile)
  document.addEventListener('keydown', shortcut)
  document.addEventListener('pointerdown', outsidePointer)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', shortcut)
  document.removeEventListener('pointerdown', outsidePointer)
  mobileQuery?.removeEventListener('change', syncMobile)
})
defineExpose({ focus: () => textarea.value?.focus() })
</script>

<template>
  <form ref="root" class="chat-composer" @submit.prevent="!disabled && !loading && $emit('submit')" @focusout="focusOut">
    <AttachmentTray :attachments="attachments" @remove="$emit('remove', $event)" @retry="$emit('retry', $event)" />
    <AttachmentSkipSummary :skipped="skipped" />
    <AttachmentCommandMenu ref="attachmentMenu" v-if="commandOpen" :id="menuId" :folder-supported="folderSupported" :show-commands="slashCommand && !attachmentOpen" @select="choose" @dismiss="dismissMenu()" />
    <textarea
      ref="textarea"
      :value="modelValue"
      data-testid="chat-input"
      rows="1"
      :placeholder="mobile ? '发送消息' : '输入消息，或拖入文件'"
      aria-label="消息"
      :aria-describedby="inputHelpId"
      :aria-controls="commandOpen ? menuId : undefined"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); resize()"
      @keydown="keydown"
      @paste="paste"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <span :id="inputHelpId" class="visually-hidden">点击添加附件或输入斜杠选择资料。Enter 发送，Shift 加 Enter 换行。按 Command 或 Control 加 O 选择文件，加 Shift 选择文件夹。</span>
    <input ref="imageInput" class="native-picker" type="file" aria-label="选择图片" accept="image/jpeg,image/png,image/webp,image/gif" multiple @change="selected($event, 'picker')" />
    <input ref="fileInput" class="native-picker" type="file" aria-label="选择文件" accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.json,.log,.xlsx,.xlsm,.xls,.pptx" multiple @change="selected($event, 'picker')" />
    <input ref="folderInput" class="native-picker" type="file" aria-label="选择文件夹" webkitdirectory multiple @change="selected($event, 'folder_picker')" />
    <div v-if="showAttachmentHint && !modelValue && !attachments.length" class="attachment-hint">
      <span>可拖入图片、文件或文件夹</span>
      <button type="button" aria-label="关闭附件提示" @click="$emit('dismissHint')"><X :size="14" aria-hidden="true" /></button>
    </div>
    <footer>
      <div class="composer-meta">
        <button ref="attachmentTrigger" class="attachment-trigger" type="button" data-testid="chat-attach-trigger" aria-label="添加附件" title="添加图片、文件或文件夹" aria-haspopup="menu" :aria-expanded="commandOpen" :aria-controls="commandOpen ? menuId : undefined" @click="toggleAttachments" @keydown.down.prevent="attachmentOpen = true; nextTick(() => attachmentMenu?.focusEdge())">
          <Plus :size="20" aria-hidden="true" />
        </button>
        <label class="model-picker" :title="selectedModel?.description">
          <Sparkles :size="14" aria-hidden="true" />
          <span class="visually-hidden">对话模型</span>
          <select data-testid="chat-model-select" :value="chatModelId" aria-label="对话模型" :disabled="loading" @change="selectModel">
            <option v-for="option in modelOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
          <ChevronDown :size="13" aria-hidden="true" />
        </label>
        <button
          class="composer-context"
          type="button"
          data-testid="chat-context-summary"
          :aria-label="`当前上下文：${contextSummary}`"
          :title="`当前上下文：${contextSummary}`"
          @click="$emit('open-context')"
        >
          <Layers3 :size="15" aria-hidden="true" />
          <span>{{ contextSummary }}</span>
        </button>
      </div>
      <span class="composer-shortcut" aria-hidden="true">Enter 发送 · Shift+Enter 换行</span>
      <button v-if="loading" class="primary-action stop" type="button" aria-label="停止生成" @click="$emit('stop')">
        <Square :size="17" fill="currentColor" aria-hidden="true" />
      </button>
      <button v-else class="primary-action" data-testid="chat-submit" type="submit" aria-label="发送消息" :disabled="disabled">
        <ArrowUp :size="20" aria-hidden="true" />
      </button>
    </footer>
    <p class="sr-announcement" aria-live="polite">{{ announcement }}</p>
  </form>
</template>

<style scoped>
.chat-composer { position: relative; container-type: inline-size; overflow: visible; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: 0 5px 20px rgb(15 23 42 / 6%); transition: border-color 150ms, box-shadow 150ms; }
.chat-composer:focus-within { border-color: var(--primary-border); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 8%, transparent), 0 5px 20px rgb(15 23 42 / 6%); }
textarea { display: block; width: 100%; min-height: 54px; max-height: 240px; resize: none; overflow-y: auto; border: 0; outline: 0; background: transparent; padding: 16px 18px 7px; color: var(--foreground); font: inherit; line-height: 1.6; box-shadow: none; }
textarea::placeholder { color: var(--muted-foreground); opacity: .8; }
footer { display: flex; min-height: 52px; align-items: center; gap: 12px; padding: 2px 10px 10px; }
.composer-meta { display: flex; min-width: 0; flex: 1; align-items: center; gap: 8px; }
.attachment-trigger { display: inline-grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--muted-foreground); cursor: pointer; }
.attachment-trigger:hover, .attachment-trigger[aria-expanded='true'] { background: var(--surface-muted); color: var(--foreground); }
.attachment-trigger:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.model-picker { display: inline-flex; min-width: 0; min-height: 36px; flex: 0 1 auto; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 10px; background: var(--primary-soft); padding: 0 10px; color: var(--foreground); transition: border-color var(--lyle-duration-fast) var(--lyle-ease-standard), background var(--lyle-duration-fast) var(--lyle-ease-standard), box-shadow var(--lyle-duration-fast) var(--lyle-ease-standard); }
.model-picker:hover { border-color: var(--primary-border); background: color-mix(in srgb, var(--primary-soft) 82%, var(--surface)); }
.model-picker:focus-within { border-color: var(--primary-border); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 11%, transparent); }
.model-picker svg:first-child { flex: 0 0 auto; color: var(--primary); }
.model-picker select { min-width: 0; max-width: 168px; appearance: none; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; font-weight: 600; line-height: 1.4; cursor: pointer; text-overflow: ellipsis; }
.model-picker select:disabled { cursor: not-allowed; opacity: .65; }
.model-picker svg:last-child { flex: 0 0 auto; color: var(--muted-foreground); pointer-events: none; }
.composer-context { display: inline-flex; align-items: center; gap: 7px; min-width: 0; min-height: 36px; max-width: 260px; overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--muted-foreground); padding: 0 10px; font-size: 12px; font-weight: 400; text-align: left; cursor: pointer; }
.composer-context svg { flex: 0 0 auto; }
.composer-context > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-context:hover { background: var(--surface-muted); color: var(--foreground); }
.composer-context:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.primary-action { display: inline-grid; width: 40px; height: 40px; flex: 0 0 auto; place-items: center; border: 0; border-radius: 50%; padding: 0; background: var(--primary); color: #fff; cursor: pointer; }
.primary-action:disabled { opacity: 1; background: var(--surface-muted); color: var(--muted-foreground); cursor: not-allowed; }
.primary-action:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.primary-action.stop { background: var(--foreground); }
.composer-shortcut { flex: 0 0 auto; color: var(--muted-foreground); font-size: 10px; white-space: nowrap; }
.attachment-hint { display: flex; min-width: 0; align-items: center; gap: 5px; padding: 0 18px 4px; color: var(--muted-foreground); font-size: 11px; }
.attachment-hint span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-hint button { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; border: 0; background: transparent; padding: 0; }
.native-picker, .visually-hidden, .sr-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
@container (max-width: 700px) { .composer-shortcut { display: none; } }
@container (max-width: 540px) {
  textarea { min-height: 48px; max-height: 180px; padding: 13px 14px 5px; }
  footer { min-height: 50px; gap: 8px; padding: 2px 8px 8px; }
  .composer-meta { gap: 6px; }
  .attachment-trigger { width: 36px; height: 40px; }
  .model-picker { min-height: 40px; flex: 1 1 auto; max-width: 205px; padding-inline: 8px; gap: 4px; }
  .model-picker select { flex: 1; width: 100%; max-width: 145px; }
  .composer-context { width: 36px; min-height: 40px; flex: 0 0 auto; justify-content: center; padding: 0; }
  .composer-context > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .attachment-hint { padding-inline: 14px; }
}
@media (prefers-reduced-motion: reduce) { .chat-composer, .model-picker { transition: none; } }
</style>
