<script setup lang="ts">
import { computed } from 'vue'
import { DIRECTORY_SKIP_LABELS, directorySkippedCount, type DirectorySkip } from '@/domain/directory-entry'

const props = defineProps<{ skipped: DirectorySkip[] }>()
const counts = computed(() => Object.entries(props.skipped.reduce<Record<string, number>>((result, item) => {
  result[item.reason] = (result[item.reason] || 0) + Math.max(1, item.count || 1)
  return result
}, {})))
const total = computed(() => directorySkippedCount(props.skipped))
</script>

<template>
  <details v-if="skipped.length" class="skip-summary">
    <summary>跳过{{ skipped.some((item) => item.isMinimum) ? '至少 ' : ' ' }}{{ total }} 个文件或条目</summary>
    <ul>
      <li v-for="[reason, count] in counts" :key="reason">{{ count }} 个{{ DIRECTORY_SKIP_LABELS[reason as keyof typeof DIRECTORY_SKIP_LABELS] }}</li>
    </ul>
    <details class="skip-details">
      <summary>查看详情</summary>
      <ul><li v-for="(item, index) in skipped" :key="`${item.relativePath || item.name}-${index}`"><span>{{ item.relativePath || item.name }}</span><small>{{ item.isMinimum ? '至少 ' : '' }}{{ item.count || 1 }} 个 · {{ DIRECTORY_SKIP_LABELS[item.reason] }}</small></li></ul>
    </details>
  </details>
</template>

<style scoped>
.skip-summary { margin: 8px 10px 0; border: 1px solid var(--warning-border, #fed7aa); border-radius: 8px; background: var(--warning-surface, #fffaf0); padding: 8px 10px; color: var(--foreground); font-size: 12px; }
.skip-summary summary { cursor: pointer; font-weight: 700; }.skip-summary ul { margin: 7px 0 0; padding-left: 18px; color: var(--muted-foreground); }.skip-details { margin-top: 7px; }.skip-details li { display: flex; justify-content: space-between; gap: 10px; }.skip-details li span { overflow-wrap: anywhere; }.skip-details small { flex: 0 0 auto; }
</style>
