<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, ChevronRight, FileText } from '@lucide/vue'
import type { ChatSource } from '@/api/types'
import { chatSourcesSummary, groupChatSources, type ChatSourceFragment } from '@/domain/chat-sources'

const props = defineProps<{ sources: ChatSource[] }>()
const emit = defineEmits<{ select: [source: ChatSource, index: number] }>()
const groups = computed(() => groupChatSources(props.sources))
const summary = computed(() => chatSourcesSummary(groups.value))

function selectFragment(event: MouseEvent, fragment: ChatSourceFragment) {
  const disclosure = (event.currentTarget as HTMLElement).parentElement as HTMLDetailsElement | null
  if (!disclosure?.open) emit('select', fragment.source, fragment.index)
}
</script>

<template>
  <details v-if="sources.length" class="chat-sources" data-testid="chat-sources">
    <summary class="chat-sources-toggle" :aria-label="summary">
      <BookOpen :size="16" class="chat-sources-symbol" aria-hidden="true" />
      <span class="chat-sources-label">资料来源</span>
      <span class="chat-sources-count">{{ groups.length }} 份文档 · {{ sources.length }} 个片段</span>
      <ChevronRight :size="16" class="chat-sources-chevron" aria-hidden="true" />
    </summary>

    <div class="chat-sources-body">
      <section v-for="group in groups" :key="group.key" class="chat-source-document" data-testid="chat-source-document">
        <div class="chat-source-document-head">
          <FileText :size="17" aria-hidden="true" />
          <div class="chat-source-document-title">
            <strong>{{ group.title }}</strong>
            <span>{{ group.fragments.length }} 个片段</span>
          </div>
          <div v-if="group.channels.length" class="chat-source-channels" aria-label="检索方式">
            <span v-for="channel in group.channels" :key="channel">{{ channel }}</span>
          </div>
        </div>

        <div class="chat-source-fragments">
          <details v-for="fragment in group.fragments" :key="fragment.index" class="chat-source-fragment" data-testid="chat-source-fragment">
            <summary @click="selectFragment($event, fragment)" :aria-label="`引用 ${fragment.citationIndex}：${fragment.label}`">
              <span class="chat-source-citation">{{ fragment.citationIndex }}</span>
              <span class="chat-source-excerpt">
                <strong>{{ fragment.label }}</strong>
                <span>{{ fragment.preview || '本条来源未保存片段正文' }}</span>
              </span>
              <ChevronRight :size="14" class="chat-source-fragment-chevron" aria-hidden="true" />
            </summary>
            <div class="chat-source-full-text">{{ fragment.source.chunk || '本条来源未保存片段正文。' }}</div>
          </details>
        </div>
      </section>
    </div>
  </details>
</template>

<style scoped>
.chat-sources { container-type: inline-size; width: 100%; min-width: 0; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; background: var(--surface, #fff); overflow: hidden; font-size: 13px; }
.chat-sources-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; min-height: 46px; padding: 10px 14px; list-style: none; cursor: pointer; transition: background 150ms; }
.chat-sources-toggle::-webkit-details-marker, .chat-source-fragment > summary::-webkit-details-marker { display: none; }
.chat-sources-toggle:hover, .chat-source-fragment > summary:hover { background: var(--surface-muted, #f8fafc); }
.chat-sources-toggle:focus-visible, .chat-source-fragment > summary:focus-visible { outline: 2px solid var(--primary, #5b5ce2); outline-offset: -3px; border-radius: 8px; }
.chat-sources-symbol { flex: 0 0 auto; color: var(--primary, #5b5ce2); }
.chat-sources-label { font-weight: 650; color: var(--foreground, #1f2937); }
.chat-sources-count { min-width: 0; font-size: 12px; color: var(--muted-foreground, #64748b); }
.chat-sources-chevron { margin-left: auto; flex: 0 0 auto; color: var(--muted-foreground, #64748b); transition: transform 150ms; }
.chat-sources[open] > summary .chat-sources-chevron { transform: rotate(90deg); }
.chat-sources-body { border-top: 1px solid var(--border, #e2e8f0); padding: 4px 14px 12px; }
.chat-source-document { min-width: 0; padding-top: 12px; }
.chat-source-document + .chat-source-document { margin-top: 12px; border-top: 1px solid var(--border, #e2e8f0); }
.chat-source-document-head { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px; padding: 2px 3px 10px; }
.chat-source-document-head > svg { flex: 0 0 auto; margin-top: 2px; color: var(--muted-foreground, #64748b); }
.chat-source-document-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 9px; min-width: 0; flex: 1; }
.chat-source-document-title > strong { color: var(--foreground, #1f2937); font-size: 12px; font-weight: 650; line-height: 1.65; overflow-wrap: anywhere; }
.chat-source-document-title > span { color: var(--muted-foreground, #64748b); font-size: 11px; white-space: nowrap; }
.chat-source-channels { display: flex; flex-wrap: wrap; gap: 5px; }
.chat-source-channels > span { color: var(--muted-foreground, #64748b); background: var(--surface-muted, #f1f5f9); border-radius: 5px; padding: 2px 6px; font-size: 10px; line-height: 1.7; }
.chat-source-fragments { display: grid; gap: 4px; }
.chat-source-fragment { min-width: 0; border-radius: 8px; }
.chat-source-fragment > summary { display: flex; align-items: flex-start; gap: 9px; min-width: 0; padding: 9px; list-style: none; cursor: pointer; border-radius: 8px; transition: background 150ms; }
.chat-source-citation { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; flex: 0 0 auto; padding: 0 4px; border-radius: 6px; background: var(--primary-soft, #eef2ff); color: var(--primary, #5b5ce2); font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; }
.chat-source-excerpt { min-width: 0; flex: 1; color: var(--muted-foreground, #64748b); line-height: 1.6; }
.chat-source-excerpt > strong { display: block; color: var(--foreground, #334155); font-size: 11px; font-weight: 550; overflow-wrap: anywhere; }
.chat-source-excerpt > span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: 12px; }
.chat-source-fragment-chevron { margin-top: 4px; color: var(--muted-foreground, #64748b); flex: 0 0 auto; transition: transform 150ms; }
.chat-source-fragment[open] > summary .chat-source-fragment-chevron { transform: rotate(90deg); }
.chat-source-fragment[open] > summary .chat-source-excerpt > span { display: none; }
.chat-source-fragment[open] { background: var(--surface-muted, #f8fafc); }
.chat-source-full-text { max-height: 320px; overflow: auto; padding: 2px 12px 14px 40px; color: var(--foreground, #334155); font-size: 12px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
@container (max-width: 540px) {
  .chat-sources-toggle { padding: 10px 12px; gap: 7px; }
  .chat-sources-body { padding-inline: 8px; }
  .chat-source-document-head { gap: 7px; }
  .chat-source-channels { flex-basis: 100%; margin-left: 24px; }
  .chat-source-full-text { padding: 2px 10px 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .chat-sources-toggle, .chat-sources-chevron, .chat-source-fragment > summary, .chat-source-fragment-chevron { transition: none; }
}
</style>
