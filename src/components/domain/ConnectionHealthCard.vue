<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpRight, FolderGit2, GitBranch, Plug, Puzzle } from '@lucide/vue'
import type { ConnectionDiagnostic } from '@/api/types'
import AppButton from '@/components/ui/AppButton.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'

const props = defineProps<{
  item: ConnectionDiagnostic
  loading?: boolean
  error?: string
}>()

defineEmits<{ diagnose: [item: ConnectionDiagnostic] }>()

const icon = computed(() => {
  switch (props.item.type) {
    case 'local_project': return FolderGit2
    case 'github': return GitBranch
    case 'mcp': return Puzzle
    default: return Plug
  }
})
// Only explicit setup placeholders get a neutral badge. Some failed connectors
// do not provide a timestamp, so a missing date alone does not mean unchecked.
const unchecked = computed(() => props.item.status === 'unavailable' && !props.item.lastCheckedAt && (
  (props.item.type === 'local_project' && props.item.displayReason === '尚未授权本地工作区。') ||
  (props.item.type === 'mcp' && props.item.displayReason === '需要运行连接诊断。') ||
  (props.item.type === 'github' && props.item.displayReason === '当前没有可用的 GitHub 连接。')
))
const status = computed(() => props.loading ? 'diagnosing' : unchecked.value ? 'disabled' : props.item.status)
const label = computed(() => props.loading ? '检查中' : unchecked.value ? (props.item.diagnosable ? '待检查' : '未连接') : undefined)

function formatTime(value?: string | null) {
  if (!value) return '尚未诊断'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
</script>

<template>
  <article class="connection-card" :data-connection-id="item.id" :aria-busy="loading">
    <span class="connection-icon" aria-hidden="true"><component :is="icon" :size="23" :stroke-width="1.7" /></span>
    <div class="connection-info">
      <header><h3>{{ item.name }}</h3><StatusBadge :status="status" :label="label" /></header>
      <p class="connection-reason">{{ item.displayReason }}</p>
      <ul v-if="item.capabilities.length" class="capabilities" aria-label="允许能力"><li v-for="capability in item.capabilities" :key="capability">{{ capability }}</li></ul>
      <details class="connection-details"><summary>连接详情</summary><dl>
        <div><dt>类型</dt><dd>{{ item.type }}</dd></div>
        <div><dt>最后诊断</dt><dd>{{ formatTime(item.lastCheckedAt) }}</dd></div>
        <div v-if="!item.diagnosable && !item.actionTarget"><dt>下一步</dt><dd>{{ item.nextAction }}</dd></div>
      </dl></details>
      <p v-if="error" class="card-error" role="alert">{{ error }}</p>
    </div>
    <footer class="connection-actions">
      <AppButton v-if="item.diagnosable" variant="secondary" :loading="loading" @click="$emit('diagnose', item)">
        {{ loading ? '诊断中…' : '运行连接诊断' }}
      </AppButton>
      <RouterLink v-else-if="item.actionTarget" class="action-link" :to="item.actionTarget">{{ item.nextAction }}<ArrowUpRight :size="15" aria-hidden="true" /></RouterLink>
    </footer>
  </article>
</template>

<style scoped>
.connection-card { display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; align-items: start; gap: 18px; padding: 24px 0; border-top: 1px solid var(--border); }
.connection-icon { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: var(--primary-soft); color: var(--primary); }
.connection-info { min-width: 0; }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-height: 25px; }
h3 { margin: 0; color: var(--foreground); font-size: 16px; font-weight: 650; overflow-wrap: anywhere; }
.connection-reason { margin: 6px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.7; }
.capabilities { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 12px 0 0; padding: 0; }
.capabilities li { background: var(--surface-muted); border-radius: 5px; padding: 4px 8px; color: var(--muted-foreground); font-size: 12px; line-height: 1.4; }
.connection-details { margin-top: 10px; font-size: 12px; color: var(--muted-foreground); }
.connection-details summary { cursor: pointer; width: fit-content; }
.connection-details summary:focus-visible,.action-link:focus-visible { outline: 3px solid var(--primary-soft); outline-offset: 4px; }
dl { display: grid; gap: 7px; margin: 12px 0 0; }
dl > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 10px; }
dd { margin: 0; overflow-wrap: anywhere; }
.card-error { margin: 12px 0 0; border-radius: 8px; background: var(--danger-soft); color: var(--danger-strong); padding: 10px 12px; font-size: 13px; }
.connection-actions { padding-top: 3px; }
.connection-actions :deep(button),.action-link { min-height: 38px; font-size: 13px; font-weight: 600; }
.action-link { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--foreground); padding: 8px 12px; }
.action-link:hover { background: var(--surface-muted); border-color: var(--border-strong); }
@media (max-width: 680px) { .connection-card { grid-template-columns: 40px minmax(0, 1fr); gap: 12px; padding: 22px 0; }.connection-icon { width: 40px; height: 40px; border-radius: 10px; }.connection-actions { grid-column: 2; padding: 0; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
