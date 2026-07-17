<script setup lang="ts">
import { ArrowRight, TriangleAlert } from '@lucide/vue'
import type { MissionException } from '@/api/missions'
import { formatBeijingTime } from '@/domain/date-time'
import AppCard from '@/components/ui/AppCard.vue'

defineProps<{ exception: MissionException }>()
</script>

<template>
  <RouterLink class="link" :to="`/exceptions/${exception.id}`">
    <AppCard interactive class="exception-card">
      <span class="icon" :class="exception.severity.toLowerCase()"><TriangleAlert :size="19" /></span>
      <div>
        <header><strong>{{ exception.title }}</strong><span>{{ exception.type }}</span></header>
        <p>{{ exception.summary }}</p>
        <footer><span>{{ formatBeijingTime(exception.createdAt) }}</span><span>查看安全状态与处理动作 <ArrowRight :size="15" /></span></footer>
      </div>
    </AppCard>
  </RouterLink>
</template>

<style scoped>
.link { color: inherit; text-decoration: none; }
.exception-card { display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); }
.icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: var(--radius-lg); background: var(--warning-soft); color: var(--warning-strong); }
.icon.high, .icon.critical { background: var(--danger-soft); color: var(--danger-strong); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
header span { color: var(--muted-foreground); font-size: 11px; font-weight: 750; }
p { margin: 7px 0 12px; color: var(--muted-foreground); line-height: 1.55; }
footer { color: var(--muted-foreground); font-size: 12px; }
footer span:last-child { display: inline-flex; align-items: center; gap: 5px; color: var(--primary); font-weight: 650; }
</style>
