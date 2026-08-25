<script setup lang="ts">
import { RefreshCcw, WifiOff } from '@lucide/vue'

withDefaults(defineProps<{
  message?: string
  label?: string
  connectionFailure?: boolean
}>(), {
  message: '本次回答未能完成，请稍后重试。',
  label: '重试',
  connectionFailure: false
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="failure-card" role="alert">
    <div class="failure-copy">
      <span class="failure-icon" aria-hidden="true"><WifiOff :size="17" /></span>
      <p>{{ message }}</p>
    </div>
    <button
      class="failure-retry"
      :class="{ recovery: connectionFailure }"
      type="button"
      @click="$emit('retry')"
    >
      <RefreshCcw :size="15" aria-hidden="true" />
      {{ label }}
    </button>
  </section>
</template>

<style scoped>
.failure-card {
  display: grid;
  width: min(100%, 680px);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-muted) 70%, var(--surface));
  padding: 12px 12px 12px 14px;
}

.failure-copy { display: flex; min-width: 0; align-items: center; gap: 10px; }
.failure-copy p { margin: 0; color: var(--foreground); font-size: 13px; line-height: 1.5; }
.failure-icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--danger-soft);
  color: var(--danger);
}
.failure-retry {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--foreground);
  padding: 0 14px;
  font-size: 12px;
  font-weight: 750;
  white-space: nowrap;
}
.failure-retry:hover { border-color: var(--primary-border); background: var(--primary-soft); color: var(--primary); }
.failure-retry.recovery { border-color: var(--primary); background: var(--primary); color: white; }
.failure-retry.recovery:hover { background: var(--primary-strong, var(--primary)); color: white; filter: brightness(.96); }

@media (max-width: 640px) {
  .failure-card { grid-template-columns: 1fr; align-items: stretch; }
  .failure-retry { width: 100%; }
}
</style>
