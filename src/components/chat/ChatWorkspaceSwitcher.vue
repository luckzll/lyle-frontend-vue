<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { FileText, PanelsTopLeft } from '@lucide/vue'

const props = defineProps<{ active?: 'document' | 'context'; count: number; expanded?: boolean; documents?: { id: string; title: string }[]; selectedId?: string }>()
defineEmits<{ document: [id?: string]; context: [] }>()
const tabs = ref<HTMLElement>()
async function revealActive() { await nextTick(); if (props.expanded) tabs.value?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
watch(() => [props.selectedId, props.active, props.documents?.length], revealActive)
onMounted(revealActive)
</script>

<template>
  <div ref="tabs" class="workspace-switcher" :class="{ 'workspace-switcher--tabs': expanded }" role="group" aria-label="对话工作区">
    <template v-if="expanded && documents?.length">
      <button v-for="item in documents" :key="item.id" class="workspace-tab" type="button" :title="item.title || '未命名文档'" :aria-pressed="active === 'document' && selectedId === item.id" @click="$emit('document', item.id)"><FileText :size="14" aria-hidden="true" /><span>{{ item.title || '未命名文档' }}</span></button>
    </template>
    <button v-else class="workspace-tab" type="button" :aria-pressed="active === 'document'" @click="$emit('document')"><FileText :size="14" aria-hidden="true" /><span>文档</span><small v-if="count">{{ count }}</small></button>
    <button class="workspace-tab workspace-context-tab" type="button" aria-label="上下文" :aria-pressed="active === 'context'" @click="$emit('context')"><PanelsTopLeft :size="14" aria-hidden="true" /><span>上下文</span></button>
  </div>
</template>

<style scoped>
.workspace-switcher{display:flex;align-items:center;min-width:0;gap:3px;flex-shrink:0}
.workspace-tab{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:32px;min-width:0;max-width:220px;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.workspace-tab>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workspace-tab>svg,.workspace-tab>small{flex-shrink:0}.workspace-tab>small{font-size:10px;font-variant-numeric:tabular-nums}
.workspace-tab:hover{background:var(--surface-muted);color:var(--foreground)}.workspace-tab[aria-pressed=true]{background:var(--surface);color:var(--foreground)}
.workspace-tab:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-3px}
.workspace-switcher--tabs{height:44px;align-items:stretch;overflow-x:auto;scrollbar-width:none;flex:1;gap:0}
.workspace-switcher--tabs::-webkit-scrollbar{display:none}.workspace-switcher--tabs .workspace-tab{position:relative;flex-shrink:0;justify-content:flex-start;max-width:230px;min-height:44px;border-radius:0;padding:0 14px;border-right:1px solid color-mix(in srgb,var(--border) 60%,transparent)}
.workspace-switcher--tabs .workspace-tab[aria-pressed=true]::after{content:'';position:absolute;bottom:0;left:14px;right:14px;height:2px;background:var(--foreground);opacity:.65}
@media(max-width:540px){.workspace-switcher--tabs .workspace-tab{max-width:160px;padding-inline:10px;gap:5px}.workspace-tab{padding-inline:7px}}
</style>
