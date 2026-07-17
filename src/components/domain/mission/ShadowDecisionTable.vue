<script setup lang="ts">
import { CircleCheck, CircleHelp, CircleX } from '@lucide/vue'
import type { ShadowDecision } from '@/api/missions'

defineProps<{ decisions: ShadowDecision[] }>()

function label(value: ShadowDecision['decision']) {
  return { ALLOW: '允许', REQUIRE_CONFIRMATION: '需确认', DENY: '拒绝' }[value]
}
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead><tr><th>典型动作</th><th>工具与操作</th><th>风险</th><th>预演决策</th><th>原因</th></tr></thead>
      <tbody>
        <tr v-for="item in decisions" :key="`${item.toolRef}-${item.title}`">
          <td><strong>{{ item.title }}</strong><small>{{ item.reversibility === 'AVAILABLE' ? '支持受控撤销' : '不支持自动撤销' }}</small></td>
          <td><code>{{ item.toolRef }}</code><small>{{ item.operation }}</small></td>
          <td>{{ item.riskLevel }}</td>
          <td><span class="decision" :class="item.decision.toLowerCase()">
            <CircleCheck v-if="item.decision === 'ALLOW'" :size="14" />
            <CircleHelp v-else-if="item.decision === 'REQUIRE_CONFIRMATION'" :size="14" />
            <CircleX v-else :size="14" />
            {{ label(item.decision) }}
          </span></td>
          <td><code>{{ item.reasonCode }}</code></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-lg); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { min-width: 110px; border-bottom: 1px solid var(--border); padding: 12px; text-align: left; vertical-align: top; }
th { background: var(--surface-muted); color: var(--muted-foreground); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
tbody tr:last-child td { border-bottom: 0; }
td strong, td small { display: block; }
td small { margin-top: 4px; color: var(--muted-foreground); }
code { color: var(--muted-foreground); font-size: 11px; }
.decision { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 4px 8px; font-weight: 750; white-space: nowrap; }
.allow { background: var(--success-soft); color: var(--success-strong); }
.require_confirmation { background: var(--warning-soft); color: var(--warning-strong); }
.deny { background: var(--danger-soft); color: var(--danger-strong); }
</style>
