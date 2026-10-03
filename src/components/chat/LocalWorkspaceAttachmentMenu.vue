<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { FileText, FolderOpen, Image as ImageIcon, Plus } from '@lucide/vue'

const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ 'pick-images': []; 'pick-files': []; 'pick-folder': [] }>()
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const open = ref(false)
const activeIndex = ref(0)
const menuId = `local-attachment-menu-${useId()}`
const options = [
  { event: 'pick-images', label: '图片', detail: 'PNG、JPEG、WebP · 每张最多 10 MB', icon: ImageIcon },
  { event: 'pick-files', label: '文件', detail: 'PDF、DOCX、Excel、PPTX · 最多 5 MB', icon: FileText },
  { event: 'pick-folder', label: '文件夹', detail: '添加到当前对话，单独授权', icon: FolderOpen }
] as const

function focusItem(index: number) {
  const items = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  if (!items?.length) return
  activeIndex.value = (index + items.length) % items.length
  items[activeIndex.value]?.focus({ preventScroll: true })
}

async function show(last = false) {
  if (props.disabled) return
  open.value = true
  await nextTick()
  if (open.value) focusItem(last ? options.length - 1 : 0)
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus && !props.disabled) trigger.value?.focus({ preventScroll: true })
}

function select(event: typeof options[number]['event']) {
  if (props.disabled) return
  close(true)
  if (event === 'pick-images') emit('pick-images')
  else if (event === 'pick-files') emit('pick-files')
  else emit('pick-folder')
}

function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab') {
    // Dismiss without preventing normal forward or backward focus movement.
    close()
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : activeIndex.value + (event.key === 'ArrowUp' ? -1 : 1))
  }
}

function closeOnOutside(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close()
}

function closeOnFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close()
}

watch(() => props.disabled, disabled => { if (disabled) close() })
onMounted(() => document.addEventListener('pointerdown', closeOnOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutside))
</script>

<template>
  <div ref="root" class="local-attachment-menu" @focusout="closeOnFocusOut">
    <button ref="trigger" class="attachment-trigger" type="button" data-testid="local-attach-trigger"
      aria-label="添加附件" title="添加图片、文件或文件夹" aria-haspopup="menu"
      :aria-expanded="open" :aria-controls="open ? menuId : undefined" :disabled="disabled"
      @click="open ? close() : show()" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <Plus :size="21" aria-hidden="true" />
    </button>
    <div v-if="open" :id="menuId" ref="menu" class="attachment-popover" role="menu"
      aria-label="添加到当前对话" @keydown="menuKeydown">
      <p class="attachment-menu-heading">添加到当前对话</p>
      <button v-for="(option, index) in options" :key="option.event" type="button" role="menuitem"
        :tabindex="activeIndex === index ? 0 : -1" :disabled="disabled" @focus="activeIndex = index"
        @click="select(option.event)">
        <component :is="option.icon" :size="18" aria-hidden="true" />
        <span><strong>{{ option.label }}</strong><small :title="option.event === 'pick-files' ? '支持 PDF、DOCX、XLSX、XLSM、XLS、PPTX，以及源代码和项目配置；旧版 DOC、PPT 请先转换。' : undefined">{{ option.detail }}</small></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.local-attachment-menu{position:relative;flex:0 0 auto}
.attachment-trigger{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:var(--muted-foreground);cursor:pointer;padding:0}
.attachment-trigger:hover:not(:disabled),.attachment-trigger[aria-expanded="true"]{background:var(--primary-soft);color:var(--primary)}
.attachment-trigger:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.attachment-trigger:disabled{opacity:.45;cursor:default}
.attachment-popover{position:absolute;z-index:50;bottom:calc(100% + 10px);left:0;width:264px;max-width:calc(100vw - 40px);max-height:min(280px,45dvh);overflow-y:auto;padding:6px;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:var(--shadow-lg)}
.attachment-menu-heading{margin:0;padding:6px 10px 5px;font-size:11px;color:var(--muted-foreground)}
.attachment-popover button{display:flex;align-items:center;gap:12px;min-height:52px;width:100%;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:var(--foreground);text-align:left;cursor:pointer}
.attachment-popover button:hover,.attachment-popover button:focus-visible{background:var(--surface-muted)}
.attachment-popover button:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.attachment-popover button>svg{flex:0 0 auto;color:var(--muted-foreground)}
.attachment-popover button>span{display:grid;gap:3px}
.attachment-popover strong{font-size:13px;font-weight:550}
.attachment-popover small{font-size:11px;line-height:1.5;color:var(--muted-foreground)}
</style>
