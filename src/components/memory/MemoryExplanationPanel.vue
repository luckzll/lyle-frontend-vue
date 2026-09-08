<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, LoaderCircle, ShieldCheck } from '@lucide/vue'
import { getMemoryRecord, governMemoryRecord } from '@/api/app'
import type { MemoryRecord, UsedMemory } from '@/api/types'
import ContextPanel from '@/components/layout/ContextPanel.vue'
import { memoryReasonLabel as reasonLabel } from '@/domain/memory-presentation'

const props = withDefaults(defineProps<{
  open: boolean
  memories: UsedMemory[]
}>(), { open: false, memories: () => [] })
const emit = defineEmits<{ close: [] }>()

const expandedId = ref('')
const details = ref<Record<string, MemoryRecord>>({})
const loading = ref<Record<string, boolean>>({})
const disabling = ref<Record<string, boolean>>({})
const disabled = ref<Record<string, boolean>>({})
const errors = ref<Record<string, string>>({})

const visibleMemories = computed(() => props.memories.filter((item) => item.memoryId && item.title))

watch(() => props.open, (open) => {
  if (!open || !visibleMemories.value.length) return
  const first = visibleMemories.value[0]
  expandedId.value = first.memoryId
  void loadDetail(first.memoryId)
})

async function toggle(memoryId: string) {
  expandedId.value = expandedId.value === memoryId ? '' : memoryId
  if (expandedId.value) await loadDetail(memoryId)
}

async function loadDetail(memoryId: string) {
  if (details.value[memoryId] || loading.value[memoryId]) return
  loading.value[memoryId] = true
  errors.value[memoryId] = ''
  try {
    const response = await getMemoryRecord(memoryId)
    details.value[memoryId] = response.data
  } catch {
    errors.value[memoryId] = '来源暂时无法加载'
  } finally {
    loading.value[memoryId] = false
  }
}

async function disableMemory(memoryId: string) {
  if (disabling.value[memoryId] || disabled.value[memoryId]) return
  disabling.value[memoryId] = true
  errors.value[memoryId] = ''
  try {
    await governMemoryRecord(memoryId, 'disable')
    disabled.value[memoryId] = true
  } catch {
    errors.value[memoryId] = '停用失败，请稍后重试'
  } finally {
    disabling.value[memoryId] = false
  }
}

function reliabilityLabel(value: string) {
  return { RELIABLE: '可靠', BASIC: '基本可靠', REVIEW_REQUIRED: '待确认' }[value] || '待确认'
}

function formatDate(value?: string | null) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<template>
  <ContextPanel title="本轮使用的记忆" :open="open" variant="memory" @close="$emit('close')">
    <p class="memory-panel-intro">这些信息实际进入了本轮回答</p>

    <section v-if="!visibleMemories.length" class="memory-explanation-empty">
      <BrainCircuit :size="24" />
      <span>本轮未使用长期记忆</span>
    </section>

    <article
      v-for="memory in visibleMemories"
      :key="memory.memoryId"
      class="memory-explanation-card"
      :class="{ expanded: expandedId === memory.memoryId }"
    >
      <button class="memory-card-toggle" type="button" :aria-expanded="expandedId === memory.memoryId" @click="toggle(memory.memoryId)">
        <BrainCircuit :size="20" aria-hidden="true" />
        <strong>{{ memory.title }}</strong>
        <span class="memory-reliability" :class="memory.reliability.toLowerCase()">{{ reliabilityLabel(memory.reliability) }}</span>
        <ChevronDown v-if="expandedId === memory.memoryId" :size="18" aria-hidden="true" />
        <ChevronRight v-else :size="18" aria-hidden="true" />
      </button>

      <div v-if="expandedId === memory.memoryId" class="memory-card-body">
        <dl>
          <dt>值</dt><dd>{{ memory.valueSummary }}</dd>
          <dt>使用原因</dt><dd>{{ reasonLabel(memory.reasonCode) }}</dd>
          <dt>可靠状态</dt><dd class="reliable-copy"><ShieldCheck :size="15" />{{ reliabilityLabel(memory.reliability) }}</dd>
          <dt>来源数量</dt><dd>{{ memory.sourceCount }} 个来源</dd>
        </dl>

        <div v-if="loading[memory.memoryId]" class="memory-source-loading"><LoaderCircle :size="17" />正在加载来源…</div>
        <p v-else-if="errors[memory.memoryId]" class="memory-action-error" role="alert">{{ errors[memory.memoryId] }}</p>
        <div v-else-if="details[memory.memoryId]?.sources?.length" class="memory-sources">
          <article v-for="source in details[memory.memoryId].sources" :key="source.sourceId">
            <strong>{{ source.label }}</strong>
            <blockquote v-if="source.availability === 'AVAILABLE'">“{{ source.excerpt }}”</blockquote>
            <p v-else>{{ source.unavailableReason || '当前无法查看此来源' }}</p>
            <footer>
              <time>{{ formatDate(source.occurredAt) }}</time>
              <RouterLink v-if="source.link" :to="source.link">查看原对话 <ExternalLink :size="13" /></RouterLink>
            </footer>
          </article>
        </div>

        <div v-if="disabled[memory.memoryId]" class="memory-disabled-notice"><CheckCircle2 :size="16" />已停用，Lyle 之后不会主动使用</div>
        <div v-else class="memory-card-actions">
          <RouterLink :to="{ path: '/memory', query: { memory: memory.memoryId, action: 'correct' } }">这不对</RouterLink>
          <button type="button" :disabled="disabling[memory.memoryId]" @click="disableMemory(memory.memoryId)">
            {{ disabling[memory.memoryId] ? '处理中…' : '以后不要使用' }}
          </button>
        </div>
      </div>
    </article>

    <RouterLink class="manage-all-memory" to="/memory">管理全部记忆 <ChevronRight :size="17" /></RouterLink>
  </ContextPanel>
</template>

<style scoped>
.memory-panel-intro { margin: calc(var(--space-2) * -1) 0 0; color: var(--muted-foreground); font-size: 12px; }
.memory-explanation-empty { display: grid; min-height: 180px; place-content: center; justify-items: center; gap: var(--space-2); color: var(--muted-foreground); font-size: 13px; text-align: center; }
.memory-explanation-card { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
.memory-card-toggle { display: grid; width: 100%; min-height: 54px; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-2); border-radius: 0; background: var(--surface); color: var(--primary); padding: var(--space-3); text-align: left; }
.memory-card-toggle strong { overflow: hidden; color: var(--foreground); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.memory-reliability { border-radius: 999px; background: var(--success-soft); color: var(--success-strong); padding: 4px 7px; font-size: 10px; font-weight: 800; white-space: nowrap; }
.memory-reliability.review_required { background: var(--warning-soft); color: var(--warning-strong); }
.memory-card-body { display: grid; gap: var(--space-3); border-top: 1px solid var(--border); padding: var(--space-3); }
dl { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 12px 10px; margin: 0; font-size: 12px; }
dt { color: var(--muted-foreground); font-weight: 700; }
dd { margin: 0; color: var(--foreground); line-height: 1.5; }
.reliable-copy { display: flex; align-items: center; gap: 4px; color: var(--success-strong); font-weight: 750; }
.memory-source-loading { display: flex; align-items: center; gap: var(--space-2); border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-3); color: var(--muted-foreground); font-size: 12px; }
.memory-source-loading svg { animation: memory-spin .9s linear infinite; }
.memory-sources { display: grid; gap: var(--space-2); }
.memory-sources > article { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); }
.memory-sources strong { font-size: 12px; }
.memory-sources blockquote, .memory-sources p { margin: var(--space-2) 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
.memory-sources footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); color: var(--muted-foreground); font-size: 11px; }
.memory-sources a { display: inline-flex; align-items: center; gap: 4px; color: var(--primary); font-weight: 750; }
.memory-card-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.memory-card-actions a, .memory-card-actions button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 0 var(--space-2); font-size: 12px; font-weight: 700; }
.memory-card-actions button:disabled { opacity: .55; }
.memory-disabled-notice { display: flex; align-items: center; gap: var(--space-2); border-radius: var(--radius-md); background: var(--success-soft); color: var(--success-strong); padding: var(--space-3); font-size: 12px; font-weight: 700; }
.memory-action-error { margin: 0; color: var(--danger-strong); font-size: 12px; }
.manage-all-memory { display: flex; min-height: 42px; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); color: var(--primary); padding-top: var(--space-3); font-size: 13px; font-weight: 750; }
@keyframes memory-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .memory-card-body { max-height: 52dvh; overflow-y: auto; }
  .manage-all-memory { position: sticky; bottom: 0; background: var(--surface); padding-bottom: var(--space-2); }
}
@media (prefers-reduced-motion: reduce) { .memory-source-loading svg { animation: none; } }
</style>
