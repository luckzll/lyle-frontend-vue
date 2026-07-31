<script setup lang="ts">
import { computed } from 'vue'
import { Brain, MessageCircle, ScanSearch, ShieldCheck } from '@lucide/vue'
import type { Component } from 'vue'
import type { UsageTaskItem } from '@/api/usage'
import { formatTokens } from '@/domain/usage'

const props = defineProps<{ items: UsageTaskItem[]; loading?: boolean }>()
const total = computed(() => props.items.reduce((sum, item) => sum + item.totalTokens, 0))

function percentage(value: number) {
  return total.value <= 0 ? 0 : Math.max(1, Math.round(value * 100 / total.value))
}

function taskIcon(label: string): Component {
  if (label === '记忆整理') return Brain
  if (label === '审核与重写') return ShieldCheck
  if (label === '意图识别') return ScanSearch
  return MessageCircle
}
</script>

<template>
  <article class="breakdown-card">
    <h3>按任务</h3>
    <div v-if="loading" class="breakdown-empty">正在读取任务用量…</div>
    <div v-else-if="!items.length" class="breakdown-empty">当前周期还没有任务用量</div>
    <table v-else class="breakdown-table">
      <thead>
        <tr>
          <th scope="col">任务类型</th>
          <th scope="col">消耗（Token）</th>
          <th scope="col">占比</th>
          <th scope="col">说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.taskType">
          <th class="task-cell" scope="row">
            <span class="task-name"><component :is="taskIcon(item.label)" :size="16" aria-hidden="true" /><span>{{ item.label }}</span></span>
            <span class="task-meter" aria-hidden="true"><span :style="{ width: `${percentage(item.totalTokens)}%` }"></span></span>
          </th>
          <td class="task-number" data-label="Token"><strong>{{ formatTokens(item.totalTokens) }}</strong></td>
          <td class="task-number" data-label="占比"><strong>{{ percentage(item.totalTokens) }}%</strong></td>
          <td class="task-description">{{ item.description }}</td>
        </tr>
      </tbody>
    </table>
  </article>
</template>

<style scoped>
.breakdown-card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 14px 16px 12px; }
.breakdown-card h3 { margin: 0 0 8px; font-size: 14px; }
.breakdown-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.breakdown-table th, .breakdown-table td { border-bottom: 1px solid var(--border); padding: 9px 8px; font-size: 12px; text-align: left; }
.breakdown-table thead th { color: var(--muted-foreground); font-size: 11px; font-weight: 500; }
.breakdown-table th:first-child { width: 42%; padding-left: 0; }
.breakdown-table th:nth-child(2) { width: 16%; text-align: right; }
.breakdown-table th:nth-child(3) { width: 10%; text-align: right; }
.breakdown-table th:last-child { width: 32%; padding-right: 0; }
.breakdown-table tbody tr:last-child th, .breakdown-table tbody tr:last-child td { border-bottom: 0; }
.task-cell { font-weight: 650; }
.task-name { display: flex; align-items: center; gap: 8px; font-weight: 650; }
.task-name svg { color: var(--primary); }
.task-meter { display: block; height: 5px; margin-top: 7px; overflow: hidden; border-radius: 99px; background: var(--surface-muted); }
.task-meter span { display: block; height: 100%; border-radius: inherit; background: var(--primary); }
.task-number { text-align: right !important; }
.task-description { color: var(--muted-foreground); }
.breakdown-empty { display: grid; min-height: 120px; place-items: center; color: var(--muted-foreground); font-size: 13px; }
@media (max-width: 640px) {
  .breakdown-card { padding-inline: 14px; }
  .breakdown-table, .breakdown-table tbody { display: block; }
  .breakdown-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .breakdown-table tr { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; border-bottom: 1px solid var(--border); padding: 11px 0; }
  .breakdown-table tbody tr:last-child { border-bottom: 0; }
  .breakdown-table th:first-child, .breakdown-table td { display: block; width: auto; border: 0; padding: 0; }
  .task-cell, .task-description { grid-column: 1 / -1; }
  .task-number::before { margin-right: 6px; color: var(--muted-foreground); content: attr(data-label); font-size: 10px; font-weight: 500; }
  .task-description { font-size: 11px !important; }
}
</style>
