<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FileText, Image as ImageIcon, Plus } from '@lucide/vue'

const emit = defineEmits<{ files: [files: File[]] }>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)

function selected(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length) emit('files', files)
  input.value = ''
  open.value = false
}

function closeOnOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside)
  document.addEventListener('keydown', closeOnEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside)
  document.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
  <div ref="root" class="attachment-menu">
    <button
      class="attachment-trigger"
      type="button"
      aria-label="添加附件"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Plus :size="20" aria-hidden="true" />
    </button>
    <div v-if="open" class="attachment-popover" role="menu" aria-label="附件类型">
      <label
        role="menuitem"
        tabindex="0"
        @keydown.enter.prevent="($event.currentTarget as HTMLLabelElement).click()"
        @keydown.space.prevent="($event.currentTarget as HTMLLabelElement).click()"
      >
        <ImageIcon :size="17" aria-hidden="true" />
        <span>上传图片</span>
        <input
          type="file"
          aria-label="上传图片"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          @change="selected"
        />
      </label>
      <label
        role="menuitem"
        tabindex="0"
        @keydown.enter.prevent="($event.currentTarget as HTMLLabelElement).click()"
        @keydown.space.prevent="($event.currentTarget as HTMLLabelElement).click()"
      >
        <FileText :size="17" aria-hidden="true" />
        <span>上传文件</span>
        <input
          type="file"
          aria-label="上传文件"
          accept=".pdf,.docx,.txt,.md,.csv,.json,.log,.xlsx,.xlsm,.xls,.pptx"
          multiple
          @change="selected"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.attachment-menu { position: relative; flex: 0 0 auto; }
.attachment-trigger { display: inline-grid; width: 44px; height: 44px; place-items: center; border-radius: 50%; padding: 0; color: var(--muted-foreground); }
.attachment-trigger:hover, .attachment-trigger:focus-visible, .attachment-trigger[aria-expanded="true"] { background: var(--surface-muted); color: var(--foreground); }
.attachment-popover { position: absolute; z-index: 30; bottom: calc(100% + 8px); left: 0; min-width: 156px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-lg); padding: 5px; }
.attachment-popover label { display: flex; min-height: 42px; cursor: pointer; align-items: center; gap: 9px; border-radius: var(--radius-sm); padding: 0 10px; color: var(--foreground); font-size: 13px; }
.attachment-popover label:hover, .attachment-popover label:focus-visible { outline: none; background: var(--surface-muted); }
input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
