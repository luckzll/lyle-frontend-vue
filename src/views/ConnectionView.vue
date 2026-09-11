<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { ArrowUpRight, Plug, RefreshCw, Search, ShieldCheck } from '@lucide/vue'
import { diagnoseConnection, listRecommendedConnections } from '@/api/app'
import type { ConnectionDiagnostic } from '@/api/types'
import ConnectionHealthCard from '@/components/domain/ConnectionHealthCard.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { statusPresentation } from '@/domain/status'

const items = ref<ConnectionDiagnostic[]>([])
const checking = ref<Record<string, boolean>>({})
const pageLoading = ref(false)
const loadError = ref('')
const cardErrors = ref<Record<string, string>>({})
const query = ref('')
const filter = ref<'all' | 'healthy' | 'attention'>('all')
const filterControls = ref<HTMLElement | null>(null)
const diagnosticNotice = ref('')
const healthyCount = computed(() => items.value.filter(item => item.status === 'healthy').length)
const isChecking = computed(() => Object.values(checking.value).some(Boolean))
const filters = computed(() => [
  { id: 'all' as const, label: '全部', count: items.value.length },
  { id: 'healthy' as const, label: '已连接', count: healthyCount.value },
  { id: 'attention' as const, label: '待处理', count: items.value.length - healthyCount.value }
])
const visibleItems = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return items.value.filter(item => {
    const statusMatches = filter.value === 'all' || (filter.value === 'healthy' ? item.status === 'healthy' : item.status !== 'healthy')
    return statusMatches && (!term || [item.name, item.type, ...item.capabilities].join(' ').toLocaleLowerCase().includes(term))
  })
})

function resetFilters() {
  query.value = ''
  filter.value = 'all'
}

async function load() {
  if (pageLoading.value || isChecking.value) return
  pageLoading.value = true
  loadError.value = ''
  try {
    items.value = (await listRecommendedConnections()).data.items
    cardErrors.value = {}
    diagnosticNotice.value = ''
  } catch (error: any) {
    loadError.value = requestMessage(error, '连接数据加载失败，请确认 AI 服务可用后重试。')
  } finally {
    pageLoading.value = false
  }
}

async function diagnose(item: ConnectionDiagnostic) {
  if (!item.diagnosable || checking.value[item.id] || pageLoading.value) return
  const triggerElement = document.activeElement
  const startedWithCardFocus = triggerElement?.closest<HTMLElement>('[data-connection-id]')?.dataset.connectionId === item.id
  checking.value = { ...checking.value, [item.id]: true }
  const nextErrors = { ...cardErrors.value }
  delete nextErrors[item.id]
  cardErrors.value = nextErrors
  try {
    const response = await diagnoseConnection(item.id)
    const focusedElement = document.activeElement
    const focusedThisCard = focusedElement?.closest<HTMLElement>('[data-connection-id]')?.dataset.connectionId === item.id ||
      (focusedElement === document.body && startedWithCardFocus)
    const index = items.value.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) items.value[index] = response.data
    const hiddenByFilter = !visibleItems.value.some(candidate => candidate.id === item.id)
    diagnosticNotice.value = `${item.name}：${statusPresentation(response.data.status).label}。${hiddenByFilter ? '状态已更新，可在“全部”中查看。' : response.data.displayReason}`
    if (focusedThisCard && hiddenByFilter) {
      await nextTick()
      if (document.activeElement === document.body || document.activeElement === focusedElement) {
        filterControls.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
      }
    }
  } catch (error: any) {
    cardErrors.value = {
      ...cardErrors.value,
      [item.id]: requestMessage(error, '连接诊断失败，请稍后重试。')
    }
  } finally {
    checking.value = { ...checking.value, [item.id]: false }
  }
}

function requestMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.response?.data?.detail || error?.message || fallback
}

onMounted(load)
</script>

<template>
  <div class="connection-page">
    <PageHeader title="连接" description="把项目、工具与资料接入 Lyle，集中查看连接状态。">
      <template #actions>
        <AppButton variant="ghost" :loading="pageLoading" :disabled="isChecking" @click="load"><RefreshCw v-if="!pageLoading" :size="16" aria-hidden="true" />刷新</AppButton>
        <RouterLink class="secondary-link" to="/advanced-settings?tab=connectors">高级连接设置<ArrowUpRight :size="16" aria-hidden="true" /></RouterLink>
      </template>
    </PageHeader>

    <LoadingState v-if="pageLoading" label="正在加载连接" :cards="2" />
    <ErrorState v-else-if="loadError" title="连接加载失败" :message="loadError" @retry="load" />
    <section v-else-if="items.length" class="connection-board" aria-labelledby="connection-sources-title">
      <header class="board-header">
        <div class="board-title"><h2 id="connection-sources-title">连接来源</h2><span>{{ healthyCount }} / {{ items.length }} 已连接</span></div>
        <label class="search-field"><Search :size="16" aria-hidden="true" /><input v-model="query" aria-label="搜索连接或能力" placeholder="搜索连接或能力" type="search" /></label>
      </header>
      <div ref="filterControls" class="filter-row" role="group" aria-label="按连接状态筛选"><button v-for="option in filters" :key="option.id" type="button" :class="{ active: filter === option.id }" :aria-pressed="filter === option.id" @click="filter = option.id">{{ option.label }}<span>{{ option.count }}</span></button></div>
      <p v-if="diagnosticNotice" class="diagnostic-notice" role="status">{{ diagnosticNotice }}</p>
      <ConnectionHealthCard
        v-for="item in visibleItems"
        :key="item.id"
        :item="item"
        :loading="Boolean(checking[item.id])"
        :error="cardErrors[item.id]"
        @diagnose="diagnose"
      />
      <div v-if="!visibleItems.length" class="filtered-empty" role="status"><Search :size="26" aria-hidden="true" /><h3>没有匹配的连接</h3><p>试试其他关键词，或查看全部连接来源。</p><AppButton variant="secondary" @click="resetFilters">清除筛选</AppButton></div>
    </section>
    <section v-else class="empty-board"><EmptyState title="从一个连接开始" description="连接项目或工具，让 Lyle 可以读取你授权的资料。"><template #icon><Plug :size="28" aria-hidden="true" /></template><RouterLink class="secondary-link" to="/advanced-settings?tab=connectors">打开高级连接设置<ArrowUpRight :size="16" aria-hidden="true" /></RouterLink></EmptyState></section>
    <p class="access-note"><ShieldCheck :size="16" aria-hidden="true" /><span>仅访问你已授权的资源。连接详情中可查看允许使用的能力。</span></p>
  </div>
</template>

<style scoped>
.connection-page { display: grid; align-content: start; gap: 28px; width: min(100%, 1180px); margin: 0 auto; }
.secondary-link { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 9px 14px; font-weight: 650; font-size: 13px; }
.secondary-link:hover { background: var(--surface-muted); }
.secondary-link:focus-visible,.filter-row button:focus-visible { outline: 3px solid var(--primary-soft); outline-offset: 3px; }
.connection-board,.empty-board { border: 1px solid var(--border); background: var(--surface); border-radius: 16px; padding: 24px 28px 4px; }
.board-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.board-title { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.board-title h2 { margin: 0; font-size: 17px; font-weight: 650; }
.board-title > span { color: var(--muted-foreground); font-size: 12px; }
.search-field { display: flex; align-items: center; gap: 9px; width: 248px; min-height: 38px; padding: 0 11px; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: 8px; }
.search-field:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.search-field input { width: 100%; min-width: 0; height: 36px; margin: 0; padding: 0; border: 0; background: transparent; font-size: 13px; box-shadow: none; outline: none; }
.filter-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 20px 0 16px; }
.filter-row button { display: inline-flex; align-items: center; gap: 8px; padding: 7px 11px; border: 0; border-radius: 7px; background: transparent; color: var(--muted-foreground); font-size: 13px; font-weight: 550; cursor: pointer; }
.filter-row button:hover { background: var(--surface-muted); }
.filter-row button.active { color: var(--primary); background: var(--primary-soft); }
.filter-row button span { font-size: 11px; font-variant-numeric: tabular-nums; }
.diagnostic-notice { margin: 0 0 16px; border-radius: 8px; padding: 10px 12px; background: var(--info-soft); color: var(--info-strong); font-size: 13px; line-height: 1.7; }
.filtered-empty { display: grid; justify-items: center; gap: 12px; border-top: 1px solid var(--border); padding: 48px 16px; text-align: center; color: var(--muted-foreground); }
.filtered-empty h3 { margin: 0; color: var(--foreground); font-size: 16px; }.filtered-empty p { margin: 0 0 4px; font-size: 13px; }
.empty-board { padding: 40px 24px; }.empty-board :deep(.state) { border: 0; }
.access-note { display: flex; align-items: flex-start; justify-content: center; gap: 8px; margin: -8px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }.access-note svg { flex-shrink: 0; margin-top: 2px; }
@media (max-width: 680px) { .connection-page { gap: 22px; }.connection-board { padding: 20px 18px 0; }.board-header { align-items: stretch; flex-direction: column; gap: 16px; }.search-field { width: 100%; }.filter-row { margin: 16px 0; }.access-note { justify-content: flex-start; } }
</style>
