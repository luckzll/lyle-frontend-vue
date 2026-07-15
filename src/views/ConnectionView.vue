<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { diagnoseConnection, listRecommendedConnections } from '@/api/app'
import type { ConnectionDiagnostic } from '@/api/types'
import ConnectionHealthCard from '@/components/domain/ConnectionHealthCard.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'

const items = ref<ConnectionDiagnostic[]>([])
const checking = ref<Record<string, boolean>>({})
const pageLoading = ref(false)
const loadError = ref('')
const cardErrors = ref<Record<string, string>>({})

async function load() {
  pageLoading.value = true
  loadError.value = ''
  try {
    items.value = (await listRecommendedConnections()).data.items
  } catch (error: any) {
    loadError.value = requestMessage(error, '连接数据加载失败，请确认 AI 服务可用后重试。')
  } finally {
    pageLoading.value = false
  }
}

async function diagnose(item: ConnectionDiagnostic) {
  if (!item.diagnosable || checking.value[item.id]) return
  checking.value = { ...checking.value, [item.id]: true }
  const nextErrors = { ...cardErrors.value }
  delete nextErrors[item.id]
  cardErrors.value = nextErrors
  try {
    const response = await diagnoseConnection(item.id)
    const index = items.value.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) items.value[index] = response.data
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
    <PageHeader
      eyebrow="授权边界清晰可见"
      title="连接"
      description="连接只展示能力和资源范围，不回传或展示凭据明文。"
    >
      <template #actions>
        <RouterLink class="secondary-link" to="/advanced-settings?tab=connectors">高级连接设置</RouterLink>
      </template>
    </PageHeader>

    <LoadingState v-if="pageLoading" label="正在加载连接" :cards="2" />
    <section v-else-if="loadError" class="load-error">
      <h2>连接加载失败</h2>
      <ErrorState title="连接加载失败" :message="loadError" @retry="load" />
    </section>
    <div v-else-if="items.length" class="connection-grid">
      <ConnectionHealthCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :loading="Boolean(checking[item.id])"
        :error="cardErrors[item.id]"
        @diagnose="diagnose"
      />
    </div>
    <EmptyState
      v-else
      title="暂无推荐连接"
      description="你可以前往高级连接设置注册新的数据来源。"
    >
      <RouterLink class="secondary-link" to="/advanced-settings?tab=connectors">打开高级连接设置</RouterLink>
    </EmptyState>
  </div>
</template>

<style scoped>
.connection-page { display: grid; gap: var(--space-6); width: min(100%, 1180px); margin: 0 auto; }
.connection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.secondary-link { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 9px 14px; font-weight: 650; }
.secondary-link:hover { background: var(--surface-muted); }
.load-error { display: grid; gap: var(--space-3); }
.load-error > h2 { margin: 0; color: var(--danger-strong); font-size: 20px; }
@media (max-width: 720px) { .connection-grid { grid-template-columns: 1fr; } }
</style>
