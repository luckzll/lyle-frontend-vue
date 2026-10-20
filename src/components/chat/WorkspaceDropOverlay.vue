<script setup lang="ts">
import { FolderOpen, Upload } from '@lucide/vue'
defineProps<{ scanning?: boolean }>()
</script>

<template>
  <div class="workspace-drop-overlay" role="status" aria-live="polite">
    <span class="drop-symbol" aria-hidden="true">
      <FolderOpen v-if="scanning" :size="23" />
      <Upload v-else :size="23" />
    </span>
    <span class="drop-copy">
      <strong>{{ scanning ? '正在处理拖入内容…' : '松开即可添加文件' }}</strong>
      <small>{{ scanning ? '请稍候' : '文件加入聊天；文件夹作为本地项目打开' }}</small>
    </span>
  </div>
</template>

<style scoped>
.workspace-drop-overlay { position: relative; z-index: 6; grid-column: 1; grid-row: 2; width: min(100%, var(--chat-content-width)); min-height: 104px; justify-self: center; align-self: stretch; display: flex; pointer-events: none; align-items: center; justify-content: center; gap: 14px; padding: 16px 20px; border: 2px dashed var(--primary); border-radius: 20px; background: color-mix(in srgb, var(--surface) 94%, var(--primary)); box-shadow: var(--shadow-popover); color: var(--foreground); }
.drop-symbol { display: grid; flex: 0 0 44px; width: 44px; height: 44px; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--primary) 12%, var(--surface)); color: var(--primary); }
.drop-copy { display: grid; gap: 3px; min-width: 0; }
.drop-copy strong { font-size: 15px; line-height: 1.4; }
.drop-copy small { color: var(--muted-foreground); font-size: 12px; line-height: 1.4; }
@media (max-width: 640px) { .workspace-drop-overlay { min-height: 96px; padding: 12px 16px; } }
</style>
