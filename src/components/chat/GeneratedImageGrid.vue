<script setup lang="ts">
import { ref } from 'vue'
import { Download, Maximize2, RefreshCcw } from '@lucide/vue'
import type { ImageBatchItem } from '@/api/app'
import ImagePreviewDialog from './ImagePreviewDialog.vue'

const props = defineProps<{ items: ImageBatchItem[] }>()
defineEmits<{ retry: [index: number] }>()
const preview = ref<ImageBatchItem | null>(null)

function label(item: ImageBatchItem) {
  if (item.status === 'COMPLETED') return '已完成'
  if (item.status === 'FAILED') return '生成失败'
  if (item.status === 'CANCELLED') return '已取消'
  if (item.status === 'RUNNING') return '生成中'
  return '排队中'
}
</script>

<template>
  <div class="generated-grid">
    <article v-for="item in [...props.items].sort((a, b) => a.index - b.index)" :key="item.index" class="generated-card" :class="`status-${item.status.toLowerCase()}`">
      <button v-if="item.imageUrl" class="image-button" type="button" :aria-label="`预览结果 ${item.index + 1}`" @click="preview = item">
        <img :src="item.imageUrl" :alt="`生成结果 ${item.index + 1}`" loading="lazy" />
      </button>
      <div v-else class="image-placeholder"><span v-if="['RUNNING', 'QUEUED'].includes(item.status)" /></div>
      <div v-if="item.imageUrl" class="image-actions">
        <button type="button" aria-label="放大预览" @click="preview = item"><Maximize2 :size="16" aria-hidden="true" /></button>
        <a :href="item.imageUrl" :download="`生成结果-${item.index + 1}.png`" aria-label="下载原图"><Download :size="16" aria-hidden="true" /></a>
      </div>
      <footer>
        <span>结果 {{ item.index + 1 }}</span>
        <strong>{{ label(item) }}</strong>
      </footer>
      <button v-if="item.status === 'FAILED'" class="retry" type="button" @click="$emit('retry', item.index)">
        <RefreshCcw :size="14" aria-hidden="true" /> 重试此项
      </button>
      <small v-if="item.error">{{ item.error }}</small>
    </article>
  </div>
  <ImagePreviewDialog :open="Boolean(preview?.imageUrl)" :src="preview?.imageUrl || ''" :alt="`生成结果 ${(preview?.index || 0) + 1}`" @close="preview = null" />
</template>

<style scoped>
.generated-grid { display: grid; width: min(100%, 760px); grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.generated-card { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
.image-button, .image-placeholder { display: block; width: 100%; aspect-ratio: 1; border: 0; border-radius: 0; background: var(--surface-muted); padding: 0; }
.image-button img { width: 100%; height: 100%; object-fit: cover; }
.image-placeholder { position: relative; overflow: hidden; }
.image-placeholder::after { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--surface) 70%, transparent) 48%, transparent 76%); content: ''; animation: shimmer 1.35s infinite; }
.image-placeholder span { position: absolute; z-index: 1; inset: 42%; border: 2px solid var(--primary-border); border-top-color: var(--primary); border-radius: 50%; animation: spin .8s linear infinite; }
.image-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
.generated-card:hover .image-actions, .generated-card:focus-within .image-actions { opacity: 1; }
.image-actions button, .image-actions a { display: inline-grid; width: 34px; height: 34px; place-items: center; border: 0; border-radius: 50%; background: rgb(0 0 0 / 62%); color: white; padding: 0; }
footer { display: flex; justify-content: space-between; gap: 8px; padding: 9px 11px; font-size: 12px; }
footer span { color: var(--muted-foreground); } footer strong { color: var(--primary); }
.retry { display: inline-flex; align-items: center; gap: 5px; margin: 0 10px 9px; padding: 6px 9px; font-size: 12px; }
small { display: block; color: var(--danger); padding: 0 11px 10px; }
.status-failed { border-color: var(--danger-border); }
@keyframes spin { to { transform: rotate(360deg); } } @keyframes shimmer { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .image-placeholder::after, .image-placeholder span { animation: none; } }
</style>
