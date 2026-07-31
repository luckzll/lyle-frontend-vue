<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import type { UsageTurn } from '@/api/usage'
import { formatTokens, formatUsageTime, measurementLabel } from '@/domain/usage'

defineProps<{ items: UsageTurn[]; loading?: boolean }>()
</script>

<template>
  <article class="turn-card">
    <h3>最近消耗</h3>
    <div v-if="loading" class="turn-empty">正在读取最近消耗…</div>
    <div v-else-if="!items.length" class="turn-empty">还没有可展示的 AI 消耗</div>
    <table v-else class="turn-table">
      <thead>
        <tr>
          <th scope="col">时间</th>
          <th scope="col">工作内容</th>
          <th scope="col">任务类型</th>
          <th scope="col">消耗（Token）</th>
          <th scope="col">计量来源</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.turnId">
          <td class="turn-time" data-label="时间">{{ formatUsageTime(item.occurredAt) }}</td>
          <th class="turn-title" scope="row">{{ item.workTitle }}</th>
          <td data-label="任务">{{ item.taskLabel }}</td>
          <td data-label="Token"><strong>{{ formatTokens(item.totalTokens) }}</strong></td>
          <td data-label="来源">{{ measurementLabel(item.measurementSource) }}</td>
          <td class="turn-action">
            <RouterLink v-if="item.conversationId" :to="{ path: '/', query: { conversationId: item.conversationId } }">
              查看对话 <ArrowRight :size="14" aria-hidden="true" />
            </RouterLink>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </article>
</template>

<style scoped>
.turn-card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 14px 16px 12px; }
.turn-card h3 { margin: 0 0 8px; font-size: 14px; }
.turn-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.turn-table th, .turn-table td { border-bottom: 1px solid var(--border); padding: 9px 6px; color: var(--foreground); font-size: 12px; text-align: left; }
.turn-table thead th { color: var(--muted-foreground); font-size: 11px; font-weight: 500; }
.turn-table thead th:nth-child(1) { width: 13%; }
.turn-table thead th:nth-child(2) { width: 28%; }
.turn-table thead th:nth-child(3) { width: 14%; }
.turn-table thead th:nth-child(4) { width: 15%; }
.turn-table thead th:nth-child(5) { width: 17%; }
.turn-table thead th:nth-child(6) { width: 13%; }
.turn-table tbody tr:last-child th, .turn-table tbody tr:last-child td { border-bottom: 0; }
.turn-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.turn-table a { display: inline-flex; align-items: center; gap: 4px; color: var(--primary); font-weight: 700; }
.turn-empty { display: grid; min-height: 100px; place-items: center; color: var(--muted-foreground); font-size: 13px; }
@media (max-width: 640px) {
  .turn-card { padding-inline: 14px; }
  .turn-table, .turn-table tbody { display: block; }
  .turn-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .turn-table tr { display: grid; grid-template-columns: 1fr auto; gap: 7px 12px; border-bottom: 1px solid var(--border); padding: 11px 0; }
  .turn-table tbody tr:last-child { border-bottom: 0; }
  .turn-table th, .turn-table td { display: block; width: auto; border: 0; padding: 0; }
  .turn-title { grid-column: 1 / -1; grid-row: 1; font-size: 13px !important; }
  .turn-time { color: var(--muted-foreground) !important; }
  .turn-table td:not(.turn-action)::before { margin-right: 5px; color: var(--muted-foreground); content: attr(data-label); font-size: 10px; }
  .turn-action { align-self: end; text-align: right; }
}
</style>
