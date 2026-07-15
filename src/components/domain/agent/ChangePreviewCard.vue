<script setup lang="ts">
import type { ChangePreview } from '@/api/agentTasks'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'

defineProps<{ preview: ChangePreview }>()
defineEmits<{ openConfirmation: [operationId: number] }>()
</script>

<template>
  <AppCard class="preview">
    <header><div><span class="eyebrow">需要你确认</span><h3>{{ preview.actionType }}</h3></div><span class="risk">{{ preview.riskLevel }}</span></header>
    <p class="resource">{{ preview.resourceRef }}</p>
    <div class="diff">
      <section><strong>变更前</strong><pre>{{ JSON.stringify(preview.before, null, 2) }}</pre></section>
      <section><strong>变更后</strong><pre>{{ JSON.stringify(preview.after, null, 2) }}</pre></section>
    </div>
    <p class="impact">{{ preview.impact }}</p>
    <footer><span>{{ preview.undoSupported ? '支持撤销' : '当前不支持自动撤销' }}</span><AppButton @click="$emit('openConfirmation', preview.pendingOperationId)">前往确认</AppButton></footer>
  </AppCard>
</template>

<style scoped>
.preview { display: grid; gap: var(--space-4); border-color: var(--warning-border); background: color-mix(in srgb, var(--warning-soft) 45%, var(--surface)); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.eyebrow { color: var(--warning-strong); font-size: 12px; font-weight: 750; }
h3 { margin: 3px 0 0; font-size: 18px; }
.risk { border-radius: 999px; background: var(--warning-soft); padding: 4px 8px; color: var(--warning-strong); font-size: 11px; font-weight: 750; }
.resource, .impact { margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.diff { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.diff section { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); padding: var(--space-3); }
.diff strong { font-size: 12px; }
pre { max-height: 220px; margin: var(--space-2) 0 0; overflow: auto; white-space: pre-wrap; color: var(--foreground); font-size: 11px; }
footer span { color: var(--muted-foreground); font-size: 12px; }
@media (max-width: 700px) { .diff { grid-template-columns: 1fr; } footer { align-items: stretch; flex-direction: column; } }
</style>
