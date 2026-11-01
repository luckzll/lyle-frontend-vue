<script setup lang="ts">
import { FileText, PanelRightOpen } from '@lucide/vue'

defineProps<{ active?: 'document' | 'context'; count: number }>()
defineEmits<{ document: []; context: [] }>()
</script>

<template>
  <div class="workspace-switcher" role="group" aria-label="对话工作区">
    <button type="button" :aria-pressed="active === 'document'" @click="$emit('document')">
      <FileText :size="15" aria-hidden="true" /><span>文档</span><span v-if="count" class="workspace-count">{{ count }}</span>
    </button>
    <button type="button" aria-label="上下文" :aria-pressed="active === 'context'" @click="$emit('context')">
      <PanelRightOpen :size="15" aria-hidden="true" /><span>上下文</span>
    </button>
  </div>
</template>

<style scoped>
.workspace-switcher{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--border);border-radius:9px;background:var(--surface-muted);flex-shrink:0}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;border:1px solid transparent;border-radius:6px;padding:5px 10px;background:transparent;color:var(--muted-foreground);font-size:12px;white-space:nowrap;cursor:pointer}
button:hover{color:var(--foreground);background:var(--surface)}
button[aria-pressed=true]{color:var(--primary);border-color:var(--primary-border);background:var(--surface)}
button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.workspace-count{font-size:11px;font-variant-numeric:tabular-nums}
@media(max-width:420px){button{padding-inline:7px;gap:4px}}
</style>
