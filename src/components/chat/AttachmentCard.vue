<script setup lang="ts">
import { CircleAlert, FileText, LoaderCircle, RefreshCcw, X } from '@lucide/vue'
import type { ChatAttachmentDraft } from '@/domain/chat-attachment'

defineProps<{ attachment: ChatAttachmentDraft }>()
defineEmits<{ remove: []; retry: [] }>()

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <article class="attachment-card" :class="`status-${attachment.status}`">
    <img v-if="attachment.kind === 'image' && attachment.previewUrl" :src="attachment.previewUrl" alt="" />
    <span v-else class="file-icon"><FileText :size="22" aria-hidden="true" /></span>
    <span class="attachment-meta">
      <strong :title="attachment.name">{{ attachment.name }}</strong>
      <small v-if="attachment.relativePath" class="relative-path" :title="attachment.relativePath">{{ attachment.relativePath }}</small>
      <small v-if="attachment.status === 'uploading'"><LoaderCircle class="spin" :size="13" aria-hidden="true" /> 上传中</small>
      <small v-else-if="attachment.status === 'failed'" class="failure"><CircleAlert :size="13" aria-hidden="true" /> {{ attachment.error }}</small>
      <small v-else>{{ formatBytes(attachment.size) }} · {{ attachment.status === 'ready' ? '已就绪' : '等待上传' }}</small>
    </span>
    <button v-if="attachment.status === 'failed'" class="card-action" type="button" :aria-label="`重新上传 ${attachment.name}`" @click="$emit('retry')">
      <RefreshCcw :size="15" aria-hidden="true" />
    </button>
    <button class="card-action" type="button" :aria-label="`移除 ${attachment.name}`" @click="$emit('remove')">
      <X :size="16" aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.attachment-card { display: grid; min-width: 0; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); padding: 7px; }
.attachment-card img, .file-icon { width: 42px; height: 42px; border-radius: 8px; background: var(--surface-muted); object-fit: cover; }
.file-icon { display: grid; place-items: center; color: var(--muted-foreground); }
.attachment-meta { display: grid; min-width: 0; gap: 2px; }
.attachment-meta strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.attachment-meta small { display: flex; align-items: center; gap: 4px; color: var(--muted-foreground); font-size: 11px; }
.attachment-meta .failure { color: var(--danger); white-space: normal; }
.attachment-meta .relative-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-action { display: inline-grid; width: 32px; height: 32px; place-items: center; border-radius: 50%; padding: 0; }
.status-failed { border-color: var(--danger-border); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
