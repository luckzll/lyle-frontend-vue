<script setup lang="ts">
import { ChevronRight, CircleAlert, Download, FileCode2, Folder, LoaderCircle, RefreshCcw, X } from '@lucide/vue'
import { attachmentBytes, type AttachmentTreeNode } from '@/domain/attachment-tree'

defineProps<{ nodes: AttachmentTreeNode[]; readonly?: boolean }>()
defineEmits<{ remove: [id: string]; retry: [id: string]; download: [id: string] }>()
</script>

<template>
  <ul class="file-tree">
    <li v-for="node in nodes" :key="node.key">
      <details v-if="node.type === 'folder'" class="tree-folder">
        <summary><ChevronRight class="tree-chevron" :size="12" aria-hidden="true" /><Folder :size="15" aria-hidden="true" /><span>{{ node.name }}</span></summary>
        <AttachmentFileTree :nodes="node.children" :readonly="readonly" @remove="$emit('remove', $event)" @retry="$emit('retry', $event)" @download="$emit('download', $event)" />
      </details>
      <div v-else class="tree-file" :class="{ 'is-failed': node.file.status === 'failed' }" :data-file-path="node.file.path">
        <LoaderCircle v-if="node.file.status === 'uploading'" class="spin" :size="14" aria-label="上传中" />
        <CircleAlert v-else-if="node.file.status === 'failed'" :size="14" aria-label="上传失败" />
        <FileCode2 v-else :size="14" aria-hidden="true" />
        <button v-if="readonly" class="file-name file-download" type="button" :title="node.file.path" @click="$emit('download', node.file.id)">{{ node.file.name }}</button>
        <span v-else class="file-name" :title="node.file.path">{{ node.file.name }}</span>
        <small>{{ node.file.status === 'local' ? '等待上传' : node.file.status === 'uploading' ? '上传中' : attachmentBytes(node.file.size) }}</small>
        <button v-if="readonly" class="tree-action" type="button" :aria-label="`下载 ${node.file.path}`" @click="$emit('download', node.file.id)"><Download :size="13" aria-hidden="true" /></button>
        <template v-else>
          <button v-if="node.file.status === 'failed'" class="tree-action" type="button" :aria-label="`重新上传 ${node.file.path}`" @click="$emit('retry', node.file.id)"><RefreshCcw :size="13" aria-hidden="true" /></button>
          <button class="tree-action" type="button" :aria-label="`移除 ${node.file.path}`" @click="$emit('remove', node.file.id)"><X :size="13" aria-hidden="true" /></button>
        </template>
        <p v-if="node.file.status === 'failed'" class="file-error">{{ node.file.error || '上传失败，请重试' }}</p>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.file-tree { list-style: none; padding: 0; margin: 0; min-width: 0; }
.tree-folder > summary { display: flex; align-items: center; gap: 7px; min-height: 32px; cursor: pointer; list-style: none; font-size: 12px; color: var(--foreground); }
.tree-folder > summary::-webkit-details-marker { display: none; }
.tree-folder > summary span { min-width: 0; overflow-wrap: anywhere; }
.tree-folder > .file-tree { margin-left: 19px; padding-left: 9px; border-left: 1px solid var(--border); }
.tree-folder[open] > summary > .tree-chevron { transform: rotate(90deg); }
.tree-file { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; min-height: 34px; padding-left: 19px; color: var(--muted-foreground); font-size: 12px; }
.tree-file > svg { flex-shrink: 0; }
.file-name { flex: 1; min-width: 30px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--foreground); }
.file-download { text-align: left; border: 0; background: none; padding: 4px 0; font: inherit; cursor: pointer; }
.file-download:hover { color: var(--primary); }
.tree-file small { flex: 0 0 auto; font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tree-action { display: grid; place-items: center; width: 28px; height: 30px; flex: 0 0 auto; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--muted-foreground); cursor: pointer; }
.tree-action:hover { color: var(--foreground); background: var(--surface-muted); }
.tree-action:focus-visible, .file-download:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.is-failed > svg, .file-error { color: var(--danger); }
.file-error { flex-basis: 100%; margin: -2px 0 5px 21px; font-size: 11px; overflow-wrap: anywhere; }
.spin { animation: tree-spin 1s linear infinite; }
@keyframes tree-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
