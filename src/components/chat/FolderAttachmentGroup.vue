<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { ChevronRight, Folder, X } from '@lucide/vue'
import AttachmentFileTree from './AttachmentFileTree.vue'
import AttachmentSkipSummary from './AttachmentSkipSummary.vue'
import { attachmentBytes, buildAttachmentTree, type AttachmentTreeFile } from '@/domain/attachment-tree'
import type { DirectorySkip } from '@/domain/directory-entry'

const props = defineProps<{ name: string; items: AttachmentTreeFile[]; skipped?: DirectorySkip[]; readonly?: boolean }>()
defineEmits<{ remove: [id: string]; removeGroup: []; retry: [id: string]; download: [id: string] }>()
const expanded = ref(false)
const panelId = `project-files-${useId()}`
const tree = computed(() => buildAttachmentTree(props.items, props.name))
const bytes = computed(() => props.items.reduce((sum, item) => sum + item.size, 0))
const ready = computed(() => props.items.filter(item => ['ready', 'attached'].includes(item.status)).length)
const failed = computed(() => props.items.filter(item => item.status === 'failed').length)
const pending = computed(() => props.items.some(item => ['local', 'uploading'].includes(item.status)))
const progress = computed(() => props.items.length ? Math.round(ready.value / props.items.length * 100) : 0)
</script>

<template>
  <section class="folder-attachment-group" :class="{ 'has-failures': failed }" :aria-label="`${name}，上传副本`">
    <div class="project-heading">
      <button class="project-toggle" type="button" :aria-expanded="expanded" :aria-controls="panelId" @click="expanded = !expanded">
        <span class="project-icon"><Folder :size="19" aria-hidden="true" /></span>
        <span class="project-copy"><strong :title="name">{{ name }}</strong><small>上传副本<span aria-hidden="true"> · </span>{{ items.length }} 个文件<span aria-hidden="true"> · </span>{{ attachmentBytes(bytes) }}</small></span>
        <ChevronRight :size="15" class="project-chevron" :class="{ 'is-open': expanded }" aria-hidden="true" />
      </button>
      <button v-if="!readonly" class="remove-project" type="button" :aria-label="`移除整个文件夹 ${name}`" @click="$emit('removeGroup')"><X :size="15" aria-hidden="true" /></button>
    </div>
    <div class="project-status" aria-live="polite">
      <span>{{ readonly ? '已附加' : pending ? '正在上传' : failed ? '需要处理' : '已就绪' }} {{ ready }}/{{ items.length }}</span>
      <span v-if="failed" class="project-failed">{{ failed }} 个失败</span>
      <span v-if="skipped?.length" class="project-partial">部分条目未导入</span>
    </div>
    <progress v-if="pending" class="project-progress" :value="ready" :max="items.length" :aria-label="`${name} 上传进度 ${progress}%`" />
    <div :id="panelId" :hidden="!expanded" class="project-files">
      <AttachmentFileTree :nodes="tree" :readonly="readonly" @remove="$emit('remove', $event)" @retry="$emit('retry', $event)" @download="$emit('download', $event)" />
    </div>
    <AttachmentSkipSummary v-if="skipped?.length" :skipped="skipped" compact />
  </section>
</template>

<style scoped>
.folder-attachment-group { grid-column: 1 / -1; min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.project-heading { display: flex; align-items: center; padding: 9px 9px 0 11px; gap: 4px; }
.project-toggle { display: flex; min-width: 0; flex: 1; align-items: center; gap: 10px; padding: 0; border: 0; background: none; color: var(--foreground); text-align: left; cursor: pointer; }
.project-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 9px; background: var(--primary-soft); color: var(--primary); }
.project-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
.project-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.project-copy small { color: var(--muted-foreground); font-size: 10px; line-height: 1.5; }
.project-chevron { flex-shrink: 0; color: var(--muted-foreground); }
.project-chevron.is-open { transform: rotate(90deg); }
.remove-project { display: grid; width: 28px; height: 32px; flex: 0 0 auto; place-items: center; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--muted-foreground); cursor: pointer; }
.remove-project:hover { background: var(--surface-muted); color: var(--foreground); }
.project-toggle:focus-visible, .remove-project:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.project-status { display: flex; flex-wrap: wrap; gap: 5px 12px; padding: 6px 12px 10px 55px; color: var(--muted-foreground); font-size: 10px; }
.project-failed { color: var(--danger); }
.project-partial { color: var(--warning-strong); }
.project-progress { display: block; width: 100%; height: 3px; appearance: none; border: 0; background: var(--surface-muted); accent-color: var(--primary); }
.project-progress::-webkit-progress-bar { background: var(--surface-muted); }
.project-progress::-webkit-progress-value { background: var(--primary); }
.project-progress::-moz-progress-bar { background: var(--primary); }
.project-files { max-height: 300px; overflow-y: auto; border-top: 1px solid var(--border); padding: 6px 10px 8px; }
.project-files[hidden] { display: none; }
.has-failures { border-color: var(--danger-border); }
@media (max-width: 600px) { .project-files { max-height: 240px; } }
</style>
