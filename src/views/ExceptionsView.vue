<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Inbox, RefreshCw } from '@lucide/vue'
import { listMissionExceptions, type MissionException } from '@/api/missions'
import { toAppError } from '@/api/errors'
import ExceptionCard from '@/components/domain/mission/ExceptionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'

type View = 'attention' | 'acknowledged' | 'history' | 'all'
const exceptions = ref<MissionException[]>([])
const loading = ref(false)
const error = ref('')
const view = ref<View>('attention')
const tabs: Array<{ id: View; label: string }> = [
  { id: 'attention', label: '需要处理' },
  { id: 'acknowledged', label: '已知悉' },
  { id: 'history', label: '已处理' },
  { id: 'all', label: '全部' }
]
const visible = computed(() => exceptions.value.filter((item) => {
  if (view.value === 'attention') return item.status === 'OPEN'
  if (view.value === 'acknowledged') return item.status === 'ACKNOWLEDGED'
  if (view.value === 'history') return ['RESOLVED', 'DISMISSED'].includes(item.status)
  return true
}))
const groups = computed(() => {
  const order = ['CONFIRMATION', 'INPUT_REQUIRED', 'PERMISSION', 'CONNECTION', 'CONFLICT', 'BUDGET', 'FAILURE']
  const labels: Record<string, string> = {
    CONFIRMATION: '需要确认',
    INPUT_REQUIRED: '需要补充',
    PERMISSION: '权限',
    CONNECTION: '连接',
    CONFLICT: '冲突',
    BUDGET: '预算',
    FAILURE: '失败'
  }
  return order
    .map((type) => ({ type, label: labels[type], items: visible.value.filter((item) => item.type === type) }))
    .filter((group) => group.items.length)
    .concat(visible.value.some((item) => !order.includes(item.type))
      ? [{ type: 'OTHER', label: '其他', items: visible.value.filter((item) => !order.includes(item.type)) }]
      : [])
})

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    exceptions.value = (await listMissionExceptions({ limit: 200 })).data.items
  } catch (exception) {
    error.value = toAppError(exception, '异常收件箱加载失败。').message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page exceptions-page">
    <PageHeader eyebrow="V6 · 只在需要决定时打扰" title="异常收件箱" description="正常运行进入摘要；越界、预算、连接、冲突和失败在这里说明影响、最后安全状态与可选动作。">
      <template #actions><AppButton variant="secondary" size="icon" aria-label="刷新异常收件箱" :loading="loading" @click="load"><RefreshCw :size="17" /></AppButton></template>
    </PageHeader>
    <nav class="tabs" aria-label="异常事项分类">
      <button v-for="tab in tabs" :key="tab.id" :class="{ active: view === tab.id }" type="button" @click="view = tab.id">{{ tab.label }}</button>
    </nav>
    <LoadingState v-if="loading" label="正在加载异常事项" :cards="3" />
    <ErrorState v-else-if="error" title="异常收件箱加载失败" :message="error" @retry="load" />
    <EmptyState v-else-if="!visible.length" title="没有需要处理的异常" description="Lyle 会继续在已批准边界内工作，普通结果进入持续任务运行记录。"><Inbox :size="28" /></EmptyState>
    <div v-else class="groups">
      <section v-for="group in groups" :key="group.type">
        <header><h2>{{ group.label }}</h2><span>{{ group.items.length }}</span></header>
        <div class="exception-list"><ExceptionCard v-for="item in group.items" :key="item.id" :exception="item" /></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.exceptions-page { width: min(1100px, 100%); margin: 0 auto; }
.tabs { display: flex; gap: var(--space-1); overflow-x: auto; border-bottom: 1px solid var(--border); }
.tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 10px 12px; color: var(--muted-foreground); font-size: 13px; font-weight: 650; white-space: nowrap; }
.tabs button.active { border-color: var(--primary); color: var(--primary); }
.groups { display: grid; gap: var(--space-6); }.groups section > header { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }.groups h2 { margin: 0; font-size: 17px; }.groups header span { border-radius: 999px; background: var(--surface-muted); padding: 3px 8px; color: var(--muted-foreground); font-size: 11px; font-weight: 750; }
.exception-list { display: grid; gap: var(--space-3); }
</style>
