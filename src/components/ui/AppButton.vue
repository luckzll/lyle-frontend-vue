<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'

withDefaults(defineProps<{
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'icon'
  loading?: boolean
  disabled?: boolean
}>(), {
  type: 'button',
  variant: 'primary',
  size: 'md',
  loading: false,
  disabled: false
})
</script>

<template>
  <button
    class="app-button"
    :class="[`variant-${variant}`, `size-${size}`]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading"
  >
    <LoaderCircle v-if="loading" class="spinner" :size="16" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-weight: 650;
  line-height: 1.2;
  transition: background-color var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}
.app-button:not(:disabled):active { transform: translateY(1px); }
.size-sm { min-height: 32px; padding: 6px 10px; font-size: 13px; }
.size-md { min-height: 40px; padding: 9px 14px; }
.size-icon { width: 40px; min-height: 40px; padding: 0; }
.variant-primary { background: var(--primary); color: var(--primary-foreground); }
.variant-primary:hover:not(:disabled) { background: var(--primary-hover); }
.variant-secondary { border-color: var(--border); background: var(--surface); color: var(--foreground); }
.variant-secondary:hover:not(:disabled), .variant-ghost:hover:not(:disabled) { background: var(--surface-muted); }
.variant-ghost { background: transparent; color: var(--muted-foreground); }
.variant-danger { background: var(--danger); color: var(--danger-foreground); }
.variant-danger:hover:not(:disabled) { background: var(--danger-strong); }
.app-button:disabled { cursor: not-allowed; opacity: .56; }
.spinner { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } }
</style>
