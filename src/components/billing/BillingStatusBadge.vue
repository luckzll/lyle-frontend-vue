<script setup lang="ts">
import { computed } from 'vue'
import { orderStatusLabel, orderStatusTone } from '@/domain/billing'

const props = defineProps<{
  status?: string | null
  label?: string
}>()

const tone = computed(() => orderStatusTone(props.status))
</script>

<template>
  <span class="billing-status" :class="tone">
    <span aria-hidden="true"></span>
    {{ label || orderStatusLabel(status) }}
  </span>
</template>

<style scoped>
.billing-status {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--muted-foreground);
  padding: 0 9px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.billing-status > span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.billing-status.success { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.billing-status.warning { border-color: var(--warning-border); background: var(--warning-soft); color: var(--warning-strong); }
.billing-status.danger { border-color: var(--danger-border); background: var(--danger-soft); color: var(--danger-strong); }
</style>
