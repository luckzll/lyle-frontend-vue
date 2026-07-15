<script setup lang="ts">
import { computed } from 'vue'
import type { AutomationSummary } from '@/api/types'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import { formatAutomationTrigger } from '@/domain/automation-schedule'

type AutomationAction = 'run' | 'toggle' | 'edit' | 'delete' | null

const props = defineProps<{
  item: AutomationSummary
  action?: AutomationAction
}>()

const emit = defineEmits<{
  run: [item: AutomationSummary]
  toggle: [item: AutomationSummary]
  edit: [item: AutomationSummary]
  delete: [item: AutomationSummary]
  attention: [item: AutomationSummary]
  openResult: [item: AutomationSummary]
}>()

const busy = computed(() => Boolean(props.action))
const hasFailure = computed(() => Boolean(props.item.needsAttention || (props.item.consecutiveFailures ?? 0) > 0))
const projectLabel = computed(() => {
  if (props.item.projectName) return props.item.projectName
  const projectId = props.item.input?.projectId
  return projectId ? `项目 #${projectId}` : '未关联项目'
})

function formatTime(value?: string | null, empty = '暂无运行记录') {
  if (!value) return empty
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function triggerLabel() {
  return formatAutomationTrigger(props.item.triggerType, props.item.scheduleExpr, props.item.timezone)
}
</script>

<template>
  <AppCard class="automation-card" :aria-busy="busy" interactive>
    <header>
      <div class="status-line">
        <StatusBadge :status="item.status" />
        <span v-if="hasFailure" class="failure">
          {{ item.consecutiveFailures ? `连续失败 ${item.consecutiveFailures} 次` : '需要处理' }}
        </span>
      </div>
      <h3>{{ item.name }}</h3>
      <p class="trigger">{{ triggerLabel() }}</p>
    </header>

    <dl>
      <div><dt>项目</dt><dd>{{ projectLabel }}</dd></div>
      <div><dt>下次运行</dt><dd>{{ formatTime(item.nextRunAt, item.status === 'paused' ? '暂停期间不运行' : '尚未安排') }}</dd></div>
      <div><dt>上次运行</dt><dd>{{ formatTime(item.lastRunAt) }}</dd></div>
      <div class="result-row">
        <dt>最近结果</dt>
        <dd>
          <button v-if="item.lastResultId" class="result-link" type="button" @click="emit('openResult', item)">
            {{ item.lastResultTitle || '查看最近结果' }}
          </button>
          <span v-else>{{ item.lastResultTitle || '暂无运行结果' }}</span>
          <StatusBadge v-if="item.lastRunStatus" :status="item.lastRunStatus" />
        </dd>
      </div>
    </dl>

    <div class="actions">
      <AppButton
        v-if="hasFailure"
        variant="danger"
        size="sm"
        :disabled="busy"
        @click="emit('attention', item)"
      >处理失败</AppButton>
      <AppButton size="sm" :loading="action === 'run'" :disabled="busy && action !== 'run'" @click="emit('run', item)">
        运行一次
      </AppButton>
      <AppButton variant="secondary" size="sm" :loading="action === 'toggle'" :disabled="busy && action !== 'toggle'" @click="emit('toggle', item)">
        {{ item.status === 'enabled' ? '暂停' : '恢复' }}
      </AppButton>
      <AppButton variant="secondary" size="sm" :disabled="busy" @click="emit('edit', item)">设置</AppButton>
      <AppButton variant="ghost" size="sm" :disabled="busy" @click="emit('delete', item)">删除</AppButton>
    </div>
    <slot name="dialogs" />
  </AppCard>
</template>

<style scoped>
.automation-card { display: grid; gap: var(--space-4); }
header { min-width: 0; }
.status-line { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.failure { color: var(--danger-strong); font-size: 12px; font-weight: 750; }
h3 { margin: var(--space-3) 0 4px; color: var(--foreground); font-size: 18px; overflow-wrap: anywhere; }
.trigger { margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
dl { display: grid; gap: var(--space-2); margin: 0; }
dl > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: var(--space-2); border-top: 1px solid var(--border); padding-top: var(--space-2); }
dt { color: var(--muted-foreground); font-size: 13px; }
dd { min-width: 0; margin: 0; color: var(--foreground); font-size: 13px; overflow-wrap: anywhere; }
.result-row dd { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.result-link { border: 0; background: transparent; color: var(--primary); padding: 0; text-align: left; text-decoration: underline; text-underline-offset: 3px; }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: auto; }
@media (max-width: 420px) {
  dl > div { grid-template-columns: 1fr; gap: 3px; }
  .actions :deep(button) { flex: 1 1 calc(50% - var(--space-2)); }
}
</style>
