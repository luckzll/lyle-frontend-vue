<script setup lang="ts">
import { Inbox } from '@lucide/vue'

withDefaults(defineProps<{ title: string; description?: string; compact?: boolean }>(), {
  description: '',
  compact: false
})
</script>

<template>
  <section class="state" :class="{ compact }">
    <span class="icon"><slot name="icon"><Inbox :size="20" aria-hidden="true" /></slot></span>
    <strong>{{ title }}</strong>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.default" class="actions"><slot /></div>
  </section>
</template>

<style scoped>
.state { display: grid; min-height: 210px; place-items: center; align-content: center; gap: var(--space-2); border: 1px dashed var(--border-strong); border-radius: var(--radius-xl); background: var(--surface); padding: var(--space-8); text-align: center; }
.state.compact { min-height: 140px; padding: var(--space-5); }
.icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: var(--radius-lg); background: var(--surface-muted); color: var(--muted-foreground); }
.state p { max-width: 520px; margin: 0; color: var(--muted-foreground); }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-2); }
</style>
