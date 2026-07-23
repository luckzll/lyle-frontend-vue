<script setup lang="ts">
import { Folder } from '@lucide/vue'
defineProps<{ name: string; count: number; open?: boolean }>()
</script>

<template>
  <details class="folder-attachment-group" :open="open">
    <summary><Folder :size="16" aria-hidden="true" /><strong>{{ name }}</strong><small>{{ count }} 个文件</small></summary>
    <div class="folder-items"><slot /></div>
  </details>
</template>

<style scoped>
.folder-attachment-group { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 96%, var(--primary)); }
.folder-attachment-group > summary { display: flex; min-height: 42px; cursor: pointer; align-items: center; gap: 8px; padding: 7px 10px; color: var(--foreground); }.folder-attachment-group > summary strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.folder-attachment-group > summary small { margin-left: auto; color: var(--muted-foreground); }.folder-items { display: grid; gap: 7px; border-top: 1px solid var(--border); padding: 8px; }
</style>
