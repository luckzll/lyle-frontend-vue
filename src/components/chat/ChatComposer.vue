<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowUp, Square } from '@lucide/vue'
import AttachmentMenu from './AttachmentMenu.vue'
import AttachmentTray from './AttachmentTray.vue'
import type { ChatAttachmentDraft } from '@/domain/chat-attachment'

const props = defineProps<{
  modelValue: string
  attachments: ChatAttachmentDraft[]
  loading: boolean
  disabled: boolean
  announcement?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  stop: []
  files: [files: File[], source: 'picker' | 'drop' | 'paste']
  remove: [localId: string]
  retry: [localId: string]
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const composing = ref(false)
const dragDepth = ref(0)
const dragging = computed(() => dragDepth.value > 0)

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

function dragenter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  dragDepth.value += 1
}

function dragleave() { dragDepth.value = Math.max(0, dragDepth.value - 1) }
function dragover(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}
function drop(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  dragDepth.value = 0
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) emit('files', files, 'drop')
}

watch(() => props.modelValue, () => nextTick(resize))
onMounted(() => {
  resize()
})
defineExpose({ focus: () => textarea.value?.focus() })
</script>

<template>
  <form
    class="chat-composer"
    :class="{ dragging }"
    @submit.prevent="$emit('submit')"
    @dragenter.prevent="dragenter"
    @dragleave="dragleave"
    @dragover="dragover"
    @drop="drop"
  >
    <div v-if="dragging" class="drop-overlay" aria-hidden="true">将附件放到这里</div>
    <AttachmentTray :attachments="attachments" @remove="$emit('remove', $event)" @retry="$emit('retry', $event)" />
    <textarea
      ref="textarea"
      :value="modelValue"
      data-testid="chat-input"
      rows="1"
      placeholder="发送消息或添加附件…"
      aria-label="消息"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); resize()"
      @keydown="keydown"
      @paste="paste"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <footer>
      <AttachmentMenu @files="$emit('files', $event, 'picker')" />
      <span class="composer-context">当前项目 / 知识库</span>
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
textarea { display: block; width: 100%; min-height: 52px; max-height: 240px; resize: none; overflow-y: auto; border: 0; outline: 0; background: transparent; padding: 14px 16px 6px; color: var(--foreground); font: inherit; line-height: 1.55; }
footer { display: flex; min-height: 54px; align-items: center; gap: 8px; padding: 5px 8px 8px; }
.composer-context { min-width: 0; flex: 1; overflow: hidden; color: var(--muted-foreground); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.primary-action { display: inline-grid; width: 44px; height: 44px; place-items: center; border-radius: 50%; padding: 0; }
.primary-action.stop { background: var(--foreground); }
.drop-overlay { position: absolute; z-index: 15; inset: 0; display: grid; place-items: center; border: 2px dashed var(--primary); border-radius: 22px; background: color-mix(in srgb, var(--surface) 90%, var(--primary)); color: var(--primary); font-weight: 800; }
.sr-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 640px) { textarea { max-height: 180px; } .composer-context { display: none; } }
</style>
