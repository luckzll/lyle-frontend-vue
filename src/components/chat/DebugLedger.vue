<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import { ChevronRight, ChevronUp, Copy, GitBranch } from '@lucide/vue'
import type { ChatDebugDataState } from '@/domain/chat-history'

defineProps<{
  state?: ChatDebugDataState
  status: string
  summary: string
  version?: string
  truncated?: boolean
  copyState?: string
}>()
const emit = defineEmits<{ copy: [] }>()
const expanded = ref(false)
const toggle = ref<HTMLButtonElement>()
const bodyId = `debug-evidence-${useId()}`

async function collapse() {
  expanded.value = false
  await nextTick()
  toggle.value?.focus({ preventScroll: true })
}
</script>

<template>
  <section class="debug-panel debug-ledger" data-testid="chat-debug-ledger" :data-debug-state="state || 'unavailable'">
    <div class="debug-disclosure-header">
      <button
        ref="toggle"
        class="debug-ledger-toggle"
        type="button"
        data-testid="debug-ledger-toggle"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        :aria-label="expanded ? '收起本轮调试' : '展开本轮调试'"
        :aria-describedby="`${bodyId}-summary`"
        @click="expanded = !expanded"
      >
        <GitBranch class="debug-ledger-symbol" :size="17" aria-hidden="true" />
        <span class="debug-ledger-heading">
          <span class="debug-ledger-title-row">
            <strong>本轮调试</strong>
            <span class="debug-ledger-status" :data-state="truncated ? 'truncated' : state" :title="version">{{ status }}</span>
          </span>
          <span :id="`${bodyId}-summary`" class="debug-ledger-overview" data-testid="debug-ledger-overview">{{ summary }}</span>
        </span>
        <span class="debug-ledger-toggle-label" aria-hidden="true">{{ expanded ? '收起' : '展开' }}</span>
        <ChevronRight class="debug-ledger-chevron" :size="16" aria-hidden="true" />
      </button>
      <button class="debug-ledger-copy" type="button" data-testid="debug-ledger-copy" @click="emit('copy')">
        <Copy :size="14" aria-hidden="true" />
        <span>{{ copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制诊断' }}</span>
      </button>
      <span class="debug-copy-announcement" role="status">{{ copyState === 'copied' ? '诊断信息已复制' : copyState === 'failed' ? '诊断信息复制失败，请重试' : '' }}</span>
    </div>
    <!-- Keep nested disclosures mounted so live updates and outer collapse preserve their state. -->
    <div v-show="expanded" :id="bodyId" class="debug-ledger-body" data-testid="debug-ledger-body">
      <slot />
      <div class="debug-ledger-footer">
        <button type="button" data-testid="debug-ledger-collapse" @click="collapse">
          <ChevronUp :size="14" aria-hidden="true" />收起本轮调试
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.debug-disclosure-header { position: relative; display: flex; align-items: center; gap: 4px; padding: 4px 12px 4px 4px; }
.debug-ledger-toggle { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; min-height: 66px; margin: 0; padding: 10px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--foreground, #1f2937); text-align: left; cursor: pointer; }
.debug-ledger-toggle:hover { background: var(--surface-muted, #f8fafc); }
.debug-ledger-chevron { flex: 0 0 auto; color: var(--muted-foreground, #64748b); transition: transform 150ms; }
.debug-ledger-symbol { flex: 0 0 auto; color: var(--primary, #5b5ce2); }
.debug-ledger-toggle[aria-expanded='true'] .debug-ledger-chevron { transform: rotate(90deg); }
.debug-ledger-heading { display: grid; flex: 1; min-width: 0; gap: 5px; }
.debug-ledger-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.debug-ledger-title-row > strong { font-size: 13px; font-weight: 650; line-height: 1.5; }
.debug-ledger-status { border-radius: 4px; padding: 1px 6px; background: var(--surface-muted, #f1f5f9); color: var(--muted-foreground, #64748b); font-size: 10px; font-weight: 550; line-height: 1.7; }
.debug-ledger-status:not([data-state='available']) { color: var(--warning-strong, #92400e); background: var(--warning-soft, #fffbeb); }
.debug-ledger-status[data-state='pending'] { color: var(--primary, #5b5ce2); background: var(--primary-soft, #eef2ff); }
.debug-ledger-overview { color: var(--muted-foreground, #64748b); font-size: 11px; font-weight: 400; line-height: 1.7; overflow-wrap: anywhere; }
.debug-ledger-toggle-label { margin-left: auto; color: var(--muted-foreground, #64748b); font-size: 11px; font-weight: 400; white-space: nowrap; }
.debug-ledger-copy { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; min-height: 36px; margin: 0; padding: 8px 10px; border: 1px solid var(--border, #dbe3ef); border-radius: 6px; background: var(--surface, #fff); color: var(--foreground, #334155); font-size: 11px; font-weight: 550; cursor: pointer; }
.debug-ledger-copy:hover { background: var(--surface-muted, #f8fafc); }
.debug-copy-announcement { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.debug-ledger-body { border-top: 1px solid var(--border, #dbe3ef); }
.debug-ledger-footer { display: flex; justify-content: center; border-top: 1px solid var(--border, #dbe3ef); padding: 4px; }
.debug-ledger-footer > button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; margin: 0; padding: 8px 16px; border: 0; border-radius: 6px; background: transparent; color: var(--muted-foreground, #64748b); font-size: 11px; font-weight: 500; cursor: pointer; }
.debug-ledger-footer > button:hover { color: var(--primary, #5b5ce2); background: var(--surface-muted, #f8fafc); }
.debug-ledger-toggle:focus-visible, .debug-ledger-copy:focus-visible, .debug-ledger-footer > button:focus-visible { outline: 2px solid var(--primary, #5b5ce2); outline-offset: -2px; }
@container (max-width: 540px) {
  .debug-disclosure-header { align-items: flex-start; gap: 0; padding: 4px 6px 4px 2px; }
  .debug-ledger-toggle { gap: 6px; padding: 8px 6px; }
  .debug-ledger-symbol { margin-top: 2px; align-self: flex-start; }
  .debug-ledger-title-row { gap: 4px 6px; }
  .debug-ledger-toggle-label { display: none; }
  .debug-ledger-copy { min-height: 40px; padding: 8px; margin-top: 2px; gap: 4px; }
}
@media (prefers-reduced-motion: reduce) { .debug-ledger-chevron { transition: none; } }
</style>
