<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ text: string }>()
// Code and file-derived HTML remain inert; this renderer never loads model-provided images.
function inline(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
// Parse closing fences separately, preserving ordinary text immediately after a code block.
const pieces = computed(() => {
  const result: { code: boolean; text: string }[] = []; let code = false; let lines: string[] = []
  for (const line of props.text.split('\n')) {
    if (/^\s*```/.test(line)) { result.push({ code, text: lines.join('\n') }); lines = []; code = !code }
    else lines.push(line)
  }
  result.push({ code, text: lines.join('\n') }); return result
})
</script>
<template><div class="project-text"><template v-for="(piece, index) in pieces" :key="index"><pre v-if="piece.code"><code>{{ piece.text }}</code></pre><div v-else><template v-for="(line, i) in piece.text.split('\n')" :key="i"><h3 v-if="/^#{1,4}\s/.test(line)" v-html="inline(line.replace(/^#{1,4}\s+/, ''))" /><p v-else-if="line" :class="{ 'list-line': /^\s*(?:[-*]|\d+\.)\s/.test(line) }" v-html="inline(line)" /><div v-else class="line-break" /></template></div></template></div></template>
<style scoped>.project-text{line-height:1.85;overflow-wrap:anywhere}.project-text p{margin:3px 0}.project-text h3{font-size:16px;margin:18px 0 8px}.project-text pre{overflow:auto;max-height:420px;white-space:pre;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:12px}.project-text :deep(p code){font-size:.9em;background:var(--surface);padding:2px 4px;border-radius:4px}.line-break{height:9px}.list-line{padding-left:10px}</style>
