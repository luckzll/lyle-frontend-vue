<script setup lang="ts">
import { CircleCheck, CircleX, Info, X } from '@lucide/vue'
import { useToast } from '@/composables/useToast'

const { items, dismiss } = useToast()
const icons = { success: CircleCheck, danger: CircleX, info: Info }
</script>

<template>
  <Teleport to="body">
    <section class="toast-region" aria-label="操作反馈" aria-live="polite" aria-relevant="additions">
      <TransitionGroup name="toast">
        <article v-for="item in items" :key="item.id" class="toast" :class="`tone-${item.tone}`">
          <component :is="icons[item.tone]" :size="18" aria-hidden="true" />
          <div><strong>{{ item.title }}</strong><p v-if="item.message">{{ item.message }}</p></div>
          <button type="button" aria-label="关闭通知" @click="dismiss(item.id)"><X :size="15" /></button>
        </article>
      </TransitionGroup>
    </section>
  </Teleport>
</template>

<style scoped>
.toast-region { position: fixed; z-index: 200; display: grid; gap: var(--space-2); right: var(--space-5); bottom: var(--space-5); width: min(92vw, 380px); pointer-events: none; }
.toast { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: var(--space-4); box-shadow: var(--shadow-popover); pointer-events: auto; }
.toast strong { font-size: 14px; }.toast p { margin: 3px 0 0; color: var(--muted-foreground); font-size: 13px; }
.toast > button { display: grid; width: 26px; height: 26px; place-items: center; border-radius: var(--radius-sm); background: transparent; color: var(--muted-foreground); padding: 0; }
.tone-success > svg { color: var(--success-strong); }.tone-danger > svg { color: var(--danger-strong); }.tone-info > svg { color: var(--info-strong); }
.toast-enter-active, .toast-leave-active { transition: opacity var(--motion-normal), transform var(--motion-normal); }.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
@media (max-width: 540px) { .toast-region { right: var(--space-3); bottom: calc(var(--space-3) + env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { .toast-enter-active, .toast-leave-active { transition: opacity var(--motion-fast); }.toast-enter-from, .toast-leave-to { transform: none; } }
</style>
