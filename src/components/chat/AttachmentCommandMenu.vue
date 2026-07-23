<script setup lang="ts">
import { FileText, FolderOpen, Image as ImageIcon } from '@lucide/vue'
defineProps<{ folderSupported: boolean }>()
defineEmits<{ select: [command: 'image' | 'file' | 'folder'] }>()
</script>

<template>
  <div class="attachment-command-menu" role="listbox" aria-label="附件命令">
    <button type="button" role="option" @click="$emit('select', 'image')"><ImageIcon :size="17" aria-hidden="true" /><span><strong>/图片</strong><small>选择一张或多张图片</small></span></button>
    <button type="button" role="option" @click="$emit('select', 'file')"><FileText :size="17" aria-hidden="true" /><span><strong>/文件</strong><small>选择图片或文档</small></span></button>
    <button v-if="folderSupported" type="button" role="option" @click="$emit('select', 'folder')"><FolderOpen :size="17" aria-hidden="true" /><span><strong>/文件夹</strong><small>保留目录层级添加资料</small></span></button>
  </div>
</template>

<style scoped>
.attachment-command-menu { position: absolute; z-index: 35; right: 8px; bottom: calc(100% + 8px); left: 8px; display: grid; gap: 3px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-lg); padding: 5px; }
.attachment-command-menu button { display: flex; min-height: 52px; align-items: center; gap: 10px; border: 0; background: transparent; color: var(--foreground); padding: 6px 9px; text-align: left; }
.attachment-command-menu button:hover, .attachment-command-menu button:focus-visible { background: var(--surface-muted); }
.attachment-command-menu button > span { display: grid; gap: 2px; }.attachment-command-menu strong { font-size: 13px; }.attachment-command-menu small { color: var(--muted-foreground); font-size: 11px; }
</style>
