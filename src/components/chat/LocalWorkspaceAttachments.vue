<script setup lang="ts">
import { FileText, FolderOpen, X } from '@lucide/vue'
import type { LocalWorkspaceAttachment } from '@/domain/local-workspace-attachments'
import type { LocalPermissionMode } from '@/domain/local-workspace-permissions'
defineProps<{ items: LocalWorkspaceAttachment[]; disabled?: boolean }>()
const emit = defineEmits<{
  remove: [id: string]; mode: [id: string, value: LocalPermissionMode]
}>()
</script>

<template>
  <div v-if="items.length" class="local-attachments" data-testid="local-workspace-attachments">
    <ul class="attachment-list" aria-label="当前对话附件">
      <li v-for="item in items" :key="item.id" :data-attachment-id="item.id" :data-attachment-kind="item.kind">
        <img v-if="item.image" :src="item.image" :alt="item.name" />
        <FolderOpen v-else-if="item.kind === 'folder'" :size="20" aria-hidden="true" />
        <FileText v-else :size="20" aria-hidden="true" />
        <div class="attachment-copy"><strong :title="item.name">{{ item.name }}</strong>
          <small v-if="item.kind === 'image'" title="图片将在下一次发送时提供给模型">下次发送时分析</small>
          <small v-else-if="!item.writable" :title="item.path">只读附件 · 刷新后重新添加</small>
          <label v-else><span class="sr-only">{{ item.name }}的写入权限</span><select :aria-label="`${item.name}的写入权限`" :value="item.workspace?.permissions.mode" :disabled="disabled" @change="emit('mode', item.id, ($event.target as HTMLSelectElement).value as LocalPermissionMode)"><option value="read-only">仅查看</option><option value="confirm">修改前确认</option><option value="auto">允许直接修改此附件</option></select></label>
        </div>
        <button class="attachment-remove" type="button" :disabled="disabled" :aria-label="`移除附件${item.name}`" @click="emit('remove', item.id)"><X :size="14" aria-hidden="true" /></button>
      </li>
    </ul>
    <p class="attachment-help" title="文件和目录句柄仅保留在当前浏览器会话；刷新后请重新添加。每个附件单独授权写入。">附件仅用于当前对话<span v-if="items.some(item => item.kind !== 'image')"> · 每个附件单独授权写入</span></p>
  </div>
</template>

<style scoped>
.local-attachments{min-width:0;margin:7px 0 3px}
.attachment-list{display:flex;flex-wrap:nowrap;gap:7px;overflow-x:auto;overscroll-behavior-x:contain;list-style:none;margin:0;padding:2px 2px 5px;max-height:70px}
.attachment-list li{display:flex;align-items:center;gap:8px;flex:0 0 236px;min-width:0;max-width:100%;border:1px solid var(--primary-border);border-radius:10px;padding:7px 8px;background:var(--primary-soft);color:var(--primary)}
.attachment-list img{width:32px;height:32px;object-fit:cover;border-radius:6px;flex:0 0 auto}
.attachment-list svg{flex-shrink:0}
.attachment-copy{min-width:0;flex:1}
.attachment-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.5;font-weight:550;color:var(--foreground)}
.attachment-copy small{display:block;font-size:10px;line-height:1.5;color:var(--muted-foreground);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attachment-copy select{max-width:100%;border:0;background:transparent;color:var(--muted-foreground);font-size:10px;line-height:1.5;padding:0;margin-top:2px;cursor:pointer}
.attachment-remove{display:grid;place-items:center;flex:0 0 auto;width:24px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground);padding:0;cursor:pointer}
.attachment-remove:hover:not(:disabled){background:var(--surface);color:var(--foreground)}
.attachment-remove:disabled,.attachment-copy select:disabled{cursor:default;opacity:.5}
.attachment-help{font-size:10px;line-height:1.5;color:var(--muted-foreground);margin:1px 2px 0}
.attachment-remove:focus-visible,.attachment-copy select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:639px){.attachment-list li{flex-basis:220px}.attachment-help{font-size:9px}}
</style>
