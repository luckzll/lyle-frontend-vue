<script setup lang="ts">
import { FolderOpen, Upload } from '@lucide/vue'
defineProps<{ scanning?: boolean }>()
</script>

<template>
  <div class="workspace-drop-overlay" role="status" aria-live="polite">
    <span class="drop-symbol" aria-hidden="true">
      <FolderOpen v-if="scanning" :size="30" />
      <Upload v-else :size="30" />
    </span>
    <strong>{{ scanning ? '正在读取文件夹…' : '释放以添加到对话' }}</strong>
    <small>{{ scanning ? '正在处理选中的内容' : '文件夹连接为本地项目；普通文件作为附件上传' }}</small>
  </div>
</template>

<style scoped>
.workspace-drop-overlay { position: fixed; z-index: 80; inset: 16px; display: grid; pointer-events: none; place-content: center; justify-items: center; gap: 10px; border: 2px dashed var(--primary); border-radius: 20px; background: color-mix(in srgb, var(--surface) 92%, var(--primary)); color: var(--foreground); text-align: center; backdrop-filter: blur(5px); }
.drop-symbol { display: grid; width: 62px; height: 62px; place-items: center; border-radius: 18px; background: color-mix(in srgb, var(--primary) 12%, var(--surface)); color: var(--primary); }
.workspace-drop-overlay strong { font-size: 19px; }.workspace-drop-overlay small { color: var(--muted-foreground); }
@media (max-width: 640px) { .workspace-drop-overlay { inset: 8px; } }
</style>
