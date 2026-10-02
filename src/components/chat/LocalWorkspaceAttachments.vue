<script setup lang="ts">
import { FileText, FolderOpen, Image, X } from '@lucide/vue'
import type { LocalWorkspaceAttachment } from '@/domain/local-workspace-attachments'
import type { LocalPermissionMode } from '@/domain/local-workspace-permissions'
defineProps<{ items: LocalWorkspaceAttachment[]; disabled?: boolean }>()
const emit = defineEmits<{
  'pick-files': []; 'pick-folder': []; 'pick-images': []; remove: [id: string]; mode: [id: string, value: LocalPermissionMode]
}>()
</script>

<template>
  <div class="local-attachments" data-testid="local-workspace-attachments">
    <div class="attachment-actions">
      <button type="button" :disabled="disabled" @click="emit('pick-images')"><Image :size="15" aria-hidden="true" />图片</button>
      <button type="button" :disabled="disabled" @click="emit('pick-files')"><FileText :size="15" aria-hidden="true" />文件</button>
      <button type="button" :disabled="disabled" @click="emit('pick-folder')"><FolderOpen :size="15" aria-hidden="true" />文件夹</button>
      <span>附件仅用于当前对话</span>
    </div>
    <ul v-if="items.length" class="attachment-list" aria-label="当前对话附件">
      <li v-for="item in items" :key="item.id" :data-attachment-id="item.id" :data-attachment-kind="item.kind">
        <img v-if="item.image" :src="item.image" :alt="item.name" />
        <FolderOpen v-else-if="item.kind === 'folder'" :size="22" aria-hidden="true" />
        <FileText v-else :size="22" aria-hidden="true" />
        <div class="attachment-copy"><strong :title="item.name">{{ item.name }}</strong>
          <code v-if="item.path" :title="item.path">{{ item.path }}</code>
          <small v-if="item.kind === 'image'">图片将在下一次发送时提供给模型</small>
          <small v-else-if="!item.writable">只读附件 · 刷新后需重新添加</small>
          <label v-else><span class="sr-only">{{ item.name }}的写入权限</span><select :aria-label="`${item.name}的写入权限`" :value="item.workspace?.permissions.mode" :disabled="disabled" @change="emit('mode', item.id, ($event.target as HTMLSelectElement).value as LocalPermissionMode)"><option value="read-only">仅查看</option><option value="confirm">修改前确认</option><option value="auto">允许直接修改此附件</option></select></label>
        </div>
        <button class="attachment-remove" type="button" :disabled="disabled" :aria-label="`移除附件${item.name}`" @click="emit('remove', item.id)"><X :size="14" aria-hidden="true" /></button>
      </li>
    </ul>
    <p v-if="items.some(item => item.kind !== 'image')" class="attachment-help">文件和目录句柄仅保留在当前浏览器会话；刷新后请重新添加。每个附件单独授权写入。</p>
  </div>
</template>

<style scoped>
.local-attachments{min-width:0;margin:0 0 10px}.attachment-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.attachment-actions button{display:inline-flex;align-items:center;gap:5px;background:var(--surface-muted);border:1px solid var(--border);border-radius:7px;padding:5px 8px;color:var(--foreground);font-size:11px}.attachment-actions button:hover:not(:disabled){border-color:var(--primary-border);color:var(--primary)}.attachment-actions>span{font-size:10px;color:var(--muted-foreground);margin-left:auto}.attachment-list{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:9px 0 0;padding:0}.attachment-list li{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;width:260px;border:1px solid var(--primary-border);border-radius:9px;padding:8px;background:var(--primary-soft);color:var(--primary)}.attachment-list img{width:38px;height:38px;object-fit:cover;border-radius:6px}.attachment-list svg{flex-shrink:0}.attachment-copy{min-width:0;flex:1}.attachment-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;color:var(--foreground)}.attachment-copy code{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;color:var(--muted-foreground);margin-top:2px}.attachment-copy small{display:block;font-size:10px;line-height:1.6;color:var(--muted-foreground);margin-top:3px}.attachment-copy select{max-width:100%;border:0;background:transparent;color:var(--foreground);font-size:10px;margin-top:3px}.attachment-remove{display:grid;place-items:center;border:0;background:transparent;color:var(--muted-foreground);padding:4px}.attachment-help{font-size:10px;line-height:1.7;color:var(--muted-foreground);margin:7px 0 0}.attachment-actions button:focus-visible,.attachment-remove:focus-visible,.attachment-copy select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:639px){.attachment-actions>span{flex-basis:100%;margin:0}.attachment-list li{width:100%}}
</style>
