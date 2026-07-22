<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Download, FileText } from '@lucide/vue'
import type { ChatAttachment } from '@/domain/chat-attachment'
import { attachmentContentUrl } from '@/domain/chat-attachment'
import { getAuthToken } from '@/auth'

const props = defineProps<{ attachments: ChatAttachment[] }>()
const previewUrls = ref<Record<string, string>>({})

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function authorizedBlob(url: string) {
  const response = await fetch(attachmentContentUrl(url), { headers: { Authorization: `Bearer ${getAuthToken()}` } })
  if (!response.ok) throw new Error('附件读取失败')
  return URL.createObjectURL(await response.blob())
}

async function download(attachment: ChatAttachment) {
  const url = await authorizedBlob(attachment.downloadUrl || attachment.previewUrl || '')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = attachment.name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

onMounted(async () => {
  for (const attachment of props.attachments) {
    if (attachment.kind !== 'image' || !attachment.previewUrl) continue
    try { previewUrls.value[attachment.id] = await authorizedBlob(attachment.previewUrl) } catch { /* card keeps its accessible label */ }
  }
})
onBeforeUnmount(() => Object.values(previewUrls.value).forEach((url) => URL.revokeObjectURL(url)))
</script>

<template>
  <div v-if="attachments.length" class="message-attachments">
    <button
      v-for="attachment in attachments"
      :key="attachment.id"
      class="message-attachment"
      :class="attachment.kind"
      type="button"
      @click="download(attachment)"
    >
      <img v-if="attachment.kind === 'image' && previewUrls[attachment.id]" :src="previewUrls[attachment.id]" :alt="attachment.name" loading="lazy" />
      <span v-else-if="attachment.kind === 'image'" class="image-loading">{{ attachment.name }}</span>
      <span v-else class="file-icon"><FileText :size="22" aria-hidden="true" /></span>
      <span v-if="attachment.kind === 'file'" class="file-meta">
        <strong>{{ attachment.name }}</strong>
        <small>{{ attachment.mimeType }} · {{ formatBytes(attachment.size) }}</small>
      </span>
      <Download v-if="attachment.kind === 'file'" :size="16" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.message-attachments { display: grid; width: min(100%, 660px); grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 8px; }
.message-attachment { display: flex; min-width: 0; align-items: center; gap: 9px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 0; text-align: left; }
.message-attachment.image { aspect-ratio: 4 / 3; }
.message-attachment.image img { width: 100%; height: 100%; object-fit: cover; }
.image-loading { display: grid; width: 100%; height: 100%; place-items: center; overflow: hidden; background: var(--surface-muted); color: var(--muted-foreground); padding: 12px; text-overflow: ellipsis; }
.message-attachment.file { padding: 9px; }
.file-icon { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 8px; background: var(--surface-muted); }
.file-meta { display: grid; min-width: 0; flex: 1; }
.file-meta strong, .file-meta small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta small { color: var(--muted-foreground); }
</style>
