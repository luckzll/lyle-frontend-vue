<script setup lang="ts">
import { CircleAlert, RotateCcw } from '@lucide/vue'
import AppButton from '@/components/ui/AppButton.vue'

withDefaults(defineProps<{ title?: string; message: string; retrying?: boolean; retryable?: boolean }>(), {
  title: '暂时无法加载',
  retrying: false,
  retryable: true
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="state" role="alert">
    <span class="icon"><CircleAlert :size="22" aria-hidden="true" /></span>
    <div><strong>{{ title }}</strong><p>{{ message }}</p></div>
    <AppButton v-if="retryable" variant="secondary" :loading="retrying" @click="$emit('retry')">
      <RotateCcw :size="15" aria-hidden="true" /> 重试
    </AppButton>
  </section>
</template>

<style scoped>
.state { display: flex; align-items: flex-start; gap: var(--space-3); border: 1px solid var(--danger-border); border-radius: var(--radius-lg); background: var(--danger-soft); padding: var(--space-4); color: var(--danger-strong); }
.icon { display: grid; flex: 0 0 auto; width: 36px; height: 36px; place-items: center; border-radius: var(--radius-md); background: var(--surface); }
.state div { flex: 1; }.state p { margin: 4px 0 0; color: var(--foreground); }
@media (max-width: 560px) { .state { flex-wrap: wrap; }.state button { width: 100%; } }
</style>
