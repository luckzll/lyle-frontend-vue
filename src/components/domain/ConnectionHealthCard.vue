<script setup lang="ts">
import type { ConnectionDiagnostic } from '@/api/types'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'

defineProps<{
  item: ConnectionDiagnostic
  loading?: boolean
  error?: string
}>()

defineEmits<{ diagnose: [item: ConnectionDiagnostic] }>()

function formatTime(value?: string | null) {
  if (!value) return '尚未诊断'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
</script>

<template>
  <AppCard class="connection-card" :aria-busy="loading" interactive>
    <header>
      <StatusBadge :status="loading ? 'diagnosing' : item.status" />
      <span class="type">{{ item.type }}</span>
    </header>
    <div>
      <h2>{{ item.name }}</h2>
      <p>{{ item.displayReason }}</p>
    </div>
    <section>
      <strong>允许能力</strong>
      <ul><li v-for="capability in item.capabilities" :key="capability">{{ capability }}</li></ul>
    </section>
    <dl>
      <div><dt>最后诊断</dt><dd>{{ formatTime(item.lastCheckedAt) }}</dd></div>
      <div><dt>下一步</dt><dd>{{ item.nextAction }}</dd></div>
    </dl>
    <p v-if="error" class="card-error" role="alert">{{ error }}</p>
    <footer>
      <AppButton v-if="item.diagnosable" variant="secondary" :loading="loading" @click="$emit('diagnose', item)">
        {{ loading ? '诊断中…' : '运行连接诊断' }}
      </AppButton>
      <RouterLink v-else-if="item.actionTarget" class="action-link" :to="item.actionTarget">{{ item.nextAction }}</RouterLink>
    </footer>
  </AppCard>
</template>

<style scoped>
.connection-card { display: grid; gap: var(--space-4); }
header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.type { color: var(--muted-foreground); font-size: 12px; }
h2 { margin: 0 0 6px; color: var(--foreground); font-size: 19px; overflow-wrap: anywhere; }
p { margin: 0; color: var(--muted-foreground); line-height: 1.55; }
section { border-top: 1px solid var(--border); padding-top: var(--space-3); }
section strong { font-size: 13px; }
ul { margin: var(--space-2) 0 0; padding-left: 20px; color: var(--muted-foreground); }
dl { display: grid; gap: var(--space-2); margin: 0; }
dl > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: var(--space-2); }
dt { color: var(--muted-foreground); font-size: 13px; } dd { margin: 0; overflow-wrap: anywhere; }
.card-error { border: 1px solid var(--danger-border); border-radius: var(--radius-md); background: var(--danger-soft); color: var(--danger-strong); padding: var(--space-3); }
footer { margin-top: auto; }
.action-link { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 9px 14px; font-weight: 650; }
.action-link:hover { background: var(--surface-muted); }
@media (max-width: 420px) { dl > div { grid-template-columns: 1fr; gap: 3px; } footer :deep(button), .action-link { width: 100%; } }
</style>
