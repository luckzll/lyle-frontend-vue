<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { BrainCircuit, ChevronRight, LoaderCircle, Pencil } from '@lucide/vue'
import type { MemoryItem } from '@/api/types'
import { MEMORY_CATEGORY_OPTIONS, memoryCandidateSourceText, memoryCategoryLabel, memoryTargetKey } from '@/domain/memory-presentation'

const props = defineProps<{ item: MemoryItem; loading?: boolean }>()
const emit = defineEmits<{
  update: [value: { targetKey: string; value: string }]
  confirm: []
  dismiss: []
}>()

const editing = ref(false)
const draftCategory = ref('')
const draftValue = ref('')
const valueInput = ref<HTMLTextAreaElement>()
const sourceOpen = ref(false)
const id = useId()
const categoryId = `${id}-category`
const valueId = `${id}-value`
const sourceId = `${id}-source`
const categoryOptions = computed(() => {
  const targetKey = memoryTargetKey(props.item)
  return MEMORY_CATEGORY_OPTIONS.some(option => option.value === targetKey) || !targetKey
    ? MEMORY_CATEGORY_OPTIONS
    : [{ value: targetKey, label: memoryCategoryLabel(props.item) }, ...MEMORY_CATEGORY_OPTIONS]
})
const canConfirm = computed(() => editing.value
  ? Boolean(draftCategory.value.trim() && draftValue.value.trim())
  : Boolean(memoryTargetKey(props.item).trim() && props.item.value?.trim()))

async function startEditing() {
  draftCategory.value = memoryTargetKey(props.item)
  draftValue.value = props.item.value || ''
  editing.value = true
  await nextTick()
  valueInput.value?.focus()
}

function applyEdit() {
  if (!draftCategory.value.trim() || !draftValue.value.trim()) return
  emit('update', { targetKey: draftCategory.value.trim(), value: draftValue.value.trim() })
  editing.value = false
}

function confirm() {
  if (props.loading || !canConfirm.value) return
  if (editing.value) applyEdit()
  emit('confirm')
}
</script>

<template>
  <article class="candidate-memory-card personal-memory-card" :aria-busy="loading || undefined" aria-label="待确认个人记忆">
    <header class="personal-memory-heading">
      <BrainCircuit class="personal-memory-icon" :size="24" aria-hidden="true" />
      <div>
        <h3>要记住这件事吗？</h3>
        <p>由你确认，再加入长期记忆</p>
      </div>
    </header>

    <div v-if="!editing" class="personal-memory-content">
      <span class="personal-memory-category">{{ memoryCategoryLabel(item) }}</span>
      <p class="personal-memory-value">{{ item.value }}</p>
      <button class="personal-memory-text-button personal-memory-edit" type="button" :disabled="loading" @click="startEditing">
        <Pencil :size="16" aria-hidden="true" />修改
      </button>
    </div>
    <div v-else class="personal-memory-editor" @keydown.esc.stop="editing = false">
      <label :for="categoryId">记忆分类</label>
      <select :id="categoryId" v-model="draftCategory" :disabled="loading">
        <option v-if="!draftCategory" value="" disabled>选择分类</option>
        <option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <label :for="valueId">记忆内容</label>
      <textarea :id="valueId" ref="valueInput" v-model="draftValue" rows="2" :disabled="loading" />
      <div class="personal-memory-editor-actions">
        <button class="personal-memory-text-button" type="button" :disabled="loading" @click="editing = false">取消修改</button>
        <button class="personal-memory-text-button personal-memory-done" type="button" :disabled="loading || !canConfirm" @click="applyEdit">完成修改</button>
      </div>
    </div>

    <footer class="personal-memory-footer">
      <button
        class="personal-memory-text-button personal-memory-source-toggle"
        type="button"
        :aria-expanded="sourceOpen"
        :aria-controls="sourceId"
        @click="sourceOpen = !sourceOpen"
      >
        <ChevronRight :size="16" :class="{ expanded: sourceOpen }" aria-hidden="true" />{{ sourceOpen ? '收起来源' : '查看来源' }}
      </button>
      <div class="personal-memory-actions">
        <button class="personal-memory-text-button" type="button" :disabled="loading" @click="emit('dismiss')">暂不</button>
        <button class="personal-memory-confirm" type="button" :disabled="loading || !canConfirm" @click="confirm">
          <LoaderCircle v-if="loading" class="personal-memory-spinner" :size="16" aria-hidden="true" />
          {{ loading ? '处理中…' : '记住' }}
        </button>
      </div>
    </footer>
    <div v-show="sourceOpen" :id="sourceId" class="personal-memory-source">
      <span>来自本轮聊天</span>
      <blockquote>{{ memoryCandidateSourceText(item) }}</blockquote>
    </div>
  </article>
</template>

<style scoped>
.personal-memory-card {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 20px 22px 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  color: var(--foreground);
  box-shadow: none;
  white-space: normal;
  font-size: 14px;
  line-height: 1.55;
}
.personal-memory-heading { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; }
.personal-memory-icon { color: var(--primary); flex-shrink: 0; }
.personal-memory-heading h3 { margin: 0; color: var(--foreground); font-size: 15px; line-height: 1.5; font-weight: 650; }
.personal-memory-heading p { margin: 3px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
.personal-memory-content { display: flex; align-items: flex-start; gap: 12px; padding: 16px 0; border-block: 1px solid var(--border); }
.personal-memory-category { flex: 0 0 auto; max-width: 45%; padding: 4px 9px; border-radius: 6px; color: var(--accent-foreground); background: var(--accent); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.personal-memory-value { flex: 1; min-width: 0; margin: 2px 0; font-size: 15px; line-height: 1.6; font-weight: 500; overflow-wrap: anywhere; white-space: pre-wrap; }
.personal-memory-card button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: auto; margin: 0; font-size: 14px; line-height: 1.5; font-weight: 500; cursor: pointer; transition: background-color var(--motion-fast), color var(--motion-fast); }
.personal-memory-card .personal-memory-text-button { padding: 8px; border: 0; border-radius: 7px; background: transparent; color: var(--muted-foreground); box-shadow: none; }
.personal-memory-card .personal-memory-text-button:hover:not(:disabled) { background: var(--surface-muted); color: var(--foreground); }
.personal-memory-card .personal-memory-edit { flex-shrink: 0; margin: -4px -8px -4px 0; }
.personal-memory-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 12px; }
.personal-memory-card .personal-memory-source-toggle { gap: 5px; margin-left: -8px; font-size: 13px; }
.personal-memory-source-toggle svg { flex-shrink: 0; transition: transform var(--motion-fast); }
.personal-memory-source-toggle svg.expanded { transform: rotate(90deg); }
.personal-memory-actions { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.personal-memory-card .personal-memory-confirm { min-width: 72px; min-height: 38px; padding: 8px 18px; border: 1px solid transparent; border-radius: 9px; background: var(--primary); color: var(--primary-foreground); box-shadow: none; }
.personal-memory-card .personal-memory-confirm:hover:not(:disabled) { background: var(--primary-hover); }
.personal-memory-card button:disabled { opacity: .5; cursor: not-allowed; }
.personal-memory-card button:focus-visible, .personal-memory-editor :is(select, textarea):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
.personal-memory-source { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: 13px; }
.personal-memory-source > span { font-size: 12px; }
.personal-memory-source blockquote { margin: 5px 0 0; color: var(--foreground); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.personal-memory-editor { display: grid; grid-template-columns: minmax(120px, .35fr) minmax(0, 1fr); gap: 7px 14px; padding: 16px 0; border-block: 1px solid var(--border); }
.personal-memory-editor label { color: var(--muted-foreground); font-size: 12px; }
.personal-memory-editor label:first-child { grid-column: 1; grid-row: 1; }
.personal-memory-editor label:nth-of-type(2) { grid-column: 2; grid-row: 1; }
.personal-memory-editor select { grid-column: 1; grid-row: 2; }
.personal-memory-editor textarea { grid-column: 2; grid-row: 2; resize: vertical; }
.personal-memory-editor :is(select, textarea) { width: 100%; min-width: 0; margin: 0; padding: 9px 10px; border: 1px solid var(--input); border-radius: 8px; background: var(--surface); color: var(--foreground); font: inherit; }
.personal-memory-editor-actions { display: flex; grid-column: 1 / -1; justify-content: flex-end; gap: 8px; }
.personal-memory-card .personal-memory-done { color: var(--primary); }
.personal-memory-spinner { animation: memory-spin 1s linear infinite; }
@keyframes memory-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .personal-memory-spinner { animation: none; } }
@media (max-width: 540px) {
  .personal-memory-card { padding: 16px 16px 12px; border-radius: 14px; }
  .personal-memory-heading { gap: 10px; padding-bottom: 14px; }
  .personal-memory-content { flex-wrap: wrap; gap: 8px 10px; padding: 14px 0; }
  .personal-memory-category { max-width: calc(100% - 70px); }
  .personal-memory-value { flex-basis: 100%; order: 3; margin: 2px 0 0; }
  .personal-memory-card .personal-memory-edit { margin-left: auto; }
  .personal-memory-footer { gap: 8px; }
  .personal-memory-actions { gap: 8px; }
  .personal-memory-editor { grid-template-columns: minmax(0, 1fr); }
  .personal-memory-editor label:nth-of-type(2) { grid-column: 1; grid-row: 3; margin-top: 5px; }
  .personal-memory-editor textarea { grid-column: 1; grid-row: 4; }
}
</style>
