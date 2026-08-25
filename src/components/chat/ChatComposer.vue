<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, ChevronDown, Sparkles, Square, X } from '@lucide/vue'
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
}>()

const root = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const composing = ref(false)
const browserFolderSupported = ref(false)
const folderSupported = computed(() => browserFolderSupported.value && props.folderAttachmentsEnabled !== false)
const mobile = ref(false)
let mobileQuery: MediaQueryList | undefined
const commandOpen = computed(() => /^\s*\/[\p{L}]*$/u.test(props.modelValue))
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
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing.value) return
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
  emit('update:modelValue', props.modelValue.replace(/^\s*\/[\p{L}]*$/u, ''))
  const input = command === 'image' ? imageInput.value : command === 'folder' ? folderInput.value : fileInput.value
  input?.click()
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

watch(() => props.modelValue, () => nextTick(resize))
onMounted(() => {
  resize()
  const probe = document.createElement('input')
  browserFolderSupported.value = 'webkitdirectory' in probe
  mobileQuery = window.matchMedia('(max-width: 640px)')
  syncMobile()
  mobileQuery.addEventListener('change', syncMobile)
  document.addEventListener('keydown', shortcut)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', shortcut)
  mobileQuery?.removeEventListener('change', syncMobile)
})
defineExpose({ focus: () => textarea.value?.focus() })
</script>

<template>
  <form ref="root" class="chat-composer" @submit.prevent="$emit('submit')">
    <AttachmentTray :attachments="attachments" @remove="$emit('remove', $event)" @retry="$emit('retry', $event)" />
    <AttachmentSkipSummary :skipped="skipped" />
    <AttachmentCommandMenu v-if="commandOpen" :folder-supported="folderSupported" @select="choose" />
    <textarea
      ref="textarea"
      :value="modelValue"
      data-testid="chat-input"
      rows="1"
      :placeholder="mobile ? '发送消息' : '输入消息，或拖入文件'"
      aria-label="消息"
      aria-describedby="attachment-input-help"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); resize()"
      @keydown="keydown"
      @paste="paste"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <span id="attachment-input-help" class="visually-hidden">输入斜杠可选择图片、文件或文件夹。按 Command 或 Control 加 O 选择文件，加 Shift 选择文件夹。</span>
    <input ref="imageInput" class="native-picker" type="file" aria-label="选择图片" accept="image/jpeg,image/png,image/webp,image/gif" multiple @change="selected($event, 'picker')" />
    <input ref="fileInput" class="native-picker" type="file" aria-label="选择文件" accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.json,.log,.xlsx" multiple @change="selected($event, 'picker')" />
    <input ref="folderInput" class="native-picker" type="file" aria-label="选择文件夹" webkitdirectory multiple @change="selected($event, 'folder_picker')" />
    <footer>
      <div class="composer-meta">
        <div v-if="showAttachmentHint && !modelValue && !attachments.length" class="attachment-hint">
          <span>可拖入图片、文件或文件夹</span>
          <button type="button" aria-label="关闭附件提示" @click="$emit('dismissHint')"><X :size="14" aria-hidden="true" /></button>
        </div>
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
        <span class="composer-meta-divider" aria-hidden="true" />
        <span class="composer-context">当前项目 / 知识库</span>
      </div>
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
.chat-composer { position: relative; overflow: visible; border: 1px solid var(--border); border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-md); }
.chat-composer:focus-within { border-color: var(--primary-border); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent), var(--shadow-md); }
textarea { display: block; width: 100%; min-height: 48px; max-height: 240px; resize: none; overflow-y: auto; border: 0; outline: 0; background: transparent; padding: 13px 16px 5px; color: var(--foreground); font: inherit; line-height: 1.55; }
footer { display: flex; min-height: 48px; align-items: center; gap: 10px; padding: 4px 8px 8px 16px; }
.composer-meta { display: flex; min-width: 0; flex: 1; align-items: center; gap: 10px; }
.model-picker { display: inline-flex; min-width: 0; min-height: 34px; flex: 0 1 auto; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: var(--lyle-radius-lg); background: var(--primary-soft); padding: 0 10px 0 9px; color: var(--foreground); transition: border-color var(--lyle-duration-fast) var(--lyle-ease-standard), background var(--lyle-duration-fast) var(--lyle-ease-standard), box-shadow var(--lyle-duration-fast) var(--lyle-ease-standard); }
.model-picker:hover { border-color: var(--primary-border); background: color-mix(in srgb, var(--primary-soft) 82%, var(--surface)); }
.model-picker:focus-within { border-color: var(--primary-border); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 11%, transparent); }
.model-picker svg:first-child { flex: 0 0 auto; color: var(--primary); }
.model-picker select { min-width: 0; max-width: 168px; appearance: none; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; font-weight: 650; line-height: 1; cursor: pointer; }
.model-picker select:disabled { cursor: not-allowed; opacity: .65; }
.model-picker svg:last-child { flex: 0 0 auto; color: var(--muted-foreground); pointer-events: none; }
.composer-meta-divider { width: 1px; height: 16px; flex: 0 0 auto; background: var(--border); }
.composer-context { min-width: 0; overflow: hidden; color: var(--muted-foreground); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.primary-action { display: inline-grid; width: 40px; height: 40px; flex: 0 0 auto; place-items: center; border-radius: 50%; padding: 0; }
.primary-action.stop { background: var(--foreground); }
.attachment-hint { display: flex; min-width: 0; align-items: center; gap: 5px; color: var(--muted-foreground); font-size: 12px; }
.attachment-hint span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-hint button { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; border: 0; background: transparent; padding: 0; }
.native-picker, .visually-hidden, .sr-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 640px) {
  textarea { max-height: 180px; padding-inline: 14px; }
  footer { padding-left: 14px; }
  .composer-meta-divider { display: none; }
  .composer-context { display: none; }
  .model-picker select { max-width: 145px; }
}
</style>
