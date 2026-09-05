<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FileText, FolderOpen, Image as ImageIcon } from '@lucide/vue'
defineProps<{ folderSupported: boolean; showCommands?: boolean }>()
const emit = defineEmits<{ select: [command: 'image' | 'file' | 'folder']; dismiss: [] }>()
const menu = ref<HTMLElement>()
const availableHeight = ref<number>()
let anchorObserver: ResizeObserver | undefined

function measureSpace() {
  const anchor = menu.value?.parentElement
  if (!anchor) return
  let visibleTop = window.visualViewport?.offsetTop || 0
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top)
    }
  }
  availableHeight.value = Math.max(48, Math.min(280, (window.visualViewport?.height || innerHeight) * .45, anchor.getBoundingClientRect().top - visibleTop - 16))
}

onMounted(() => {
  measureSpace()
  anchorObserver = new ResizeObserver(measureSpace)
  if (menu.value?.parentElement) anchorObserver.observe(menu.value.parentElement)
  window.addEventListener('resize', measureSpace)
  window.visualViewport?.addEventListener('resize', measureSpace)
})
onBeforeUnmount(() => {
  anchorObserver?.disconnect()
  window.removeEventListener('resize', measureSpace)
  window.visualViewport?.removeEventListener('resize', measureSpace)
})

function focusItem(item?: HTMLButtonElement) {
  if (!item || !menu.value) return
  item.focus({ preventScroll: true })
  const itemRect = item.getBoundingClientRect()
  const menuRect = menu.value.getBoundingClientRect()
  const visibleTop = menuRect.top + menu.value.clientTop
  const visibleBottom = visibleTop + menu.value.clientHeight
  if (itemRect.top < visibleTop) menu.value.scrollTop -= visibleTop - itemRect.top
  else if (itemRect.bottom > visibleBottom) menu.value.scrollTop += itemRect.bottom - visibleBottom
}

function focusEdge(last = false) {
  const items = menu.value?.querySelectorAll<HTMLButtonElement>('button')
  focusItem(items?.[last ? items.length - 1 : 0])
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('dismiss')
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button') || [])
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  focusItem(items[next])
}

defineExpose({ focusEdge, containsTarget: (target: Node) => Boolean(menu.value?.contains(target)) })
</script>

<template>
  <div ref="menu" class="attachment-command-menu" :style="availableHeight == null ? undefined : { maxHeight: `${availableHeight}px` }" role="menu" aria-label="附件命令" @keydown="keydown">
    <div class="attachment-menu-heading">添加到对话</div>
    <button type="button" role="menuitem" @click="$emit('select', 'image')"><ImageIcon :size="17" aria-hidden="true" /><span><strong>{{ showCommands ? '/图片' : '图片' }}</strong><small>选择一张或多张图片</small></span></button>
    <button type="button" role="menuitem" @click="$emit('select', 'file')"><FileText :size="17" aria-hidden="true" /><span><strong>{{ showCommands ? '/文件' : '文件' }}</strong><small>PDF、Word、表格等资料</small></span></button>
    <button v-if="folderSupported" type="button" role="menuitem" @click="$emit('select', 'folder')"><FolderOpen :size="17" aria-hidden="true" /><span><strong>{{ showCommands ? '/文件夹' : '文件夹' }}</strong><small>保留目录层级添加资料</small></span></button>
  </div>
</template>

<style scoped>
.attachment-command-menu { position: absolute; z-index: 35; bottom: calc(100% + 10px); left: 10px; width: min(280px, calc(100% - 20px)); max-height: min(280px, 45dvh); overflow-y: auto; display: grid; gap: 3px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-lg); padding: 6px; }
.attachment-menu-heading { padding: 6px 10px 4px; color: var(--muted-foreground); font-size: 11px; }
.attachment-command-menu button { display: flex; min-height: 52px; align-items: center; gap: 12px; border: 0; border-radius: 9px; background: transparent; color: var(--foreground); padding: 8px 10px; text-align: left; cursor: pointer; }
.attachment-command-menu button:hover, .attachment-command-menu button:focus-visible { background: var(--surface-muted); }
.attachment-command-menu button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.attachment-command-menu button > svg { flex: 0 0 auto; color: var(--muted-foreground); }
.attachment-command-menu button > span { display: grid; gap: 2px; }.attachment-command-menu strong { font-size: 13px; }.attachment-command-menu small { color: var(--muted-foreground); font-size: 11px; }
</style>
