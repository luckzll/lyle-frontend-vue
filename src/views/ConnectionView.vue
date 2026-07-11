<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { diagnoseConnection, listRecommendedConnections } from '@/api/app'
import type { ConnectionDiagnostic } from '@/api/types'

const items = ref<ConnectionDiagnostic[]>([])
const checking = ref('')
const pageLoading = ref(false)
const loadError = ref('')
const cardErrors = ref<Record<string, string>>({})

async function load() {
  pageLoading.value = true
  loadError.value = ''
  try {
    items.value = (await listRecommendedConnections()).data.items
  } catch (error: any) {
    loadError.value = error?.response?.data?.message || error?.response?.data?.detail || '连接数据加载失败，请确认 AI 服务可用后重试。'
  } finally {
    pageLoading.value = false
  }
}

async function diagnose(item: ConnectionDiagnostic) {
  if (!item.diagnosable) return
  checking.value = item.id
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
      [item.id]: error?.response?.data?.message || error?.response?.data?.detail || '连接诊断失败，请稍后重试。'
    }
  } finally {
    checking.value = ''
  }
}

const label = (status: string) => ({
  healthy: '可用',
  reauthorize_required: '需要重新授权',
  restricted: '受限',
  unavailable: '不可用'
}[status] || status)

onMounted(load)
</script>

<template>
  <div class="page experience-page">
    <header class="page-header">
      <div><p class="eyebrow">授权边界清晰可见</p><h1>连接</h1><p class="muted">连接只展示能力和资源范围，不回传或展示凭据明文。</p></div>
      <RouterLink class="button-link secondary" to="/advanced-settings?tab=connectors">高级连接设置</RouterLink>
    </header>
    <section v-if="pageLoading" class="empty-state"><h2>正在加载连接</h2><p>正在检查推荐连接及授权状态。</p></section>
    <section v-else-if="loadError" class="empty-state error-state"><h2>连接加载失败</h2><p>{{ loadError }}</p><button type="button" @click="load">重试</button></section>
    <div v-else-if="items.length" class="experience-grid connections">
      <article v-for="item in items" :key="item.id" class="template-card">
        <div class="row between"><span class="status-pill" :class="item.status">{{ label(item.status) }}</span><span class="muted">{{ item.type }}</span></div>
        <h2>{{ item.name }}</h2>
        <p>{{ item.displayReason }}</p>
        <strong>允许能力</strong>
        <ul><li v-for="capability in item.capabilities" :key="capability">{{ capability }}</li></ul>
        <p class="muted">下一步：{{ item.nextAction }}</p>
        <p v-if="cardErrors[item.id]" class="alert danger" role="alert">{{ cardErrors[item.id] }}</p>
        <button v-if="item.diagnosable" class="secondary" :disabled="checking===item.id" @click="diagnose(item)">{{ checking===item.id ? '诊断中…' : '运行连接诊断' }}</button>
        <RouterLink v-else-if="item.actionTarget" class="button-link secondary" :to="item.actionTarget">{{ item.nextAction }}</RouterLink>
      </article>
    </div>
    <section v-else class="empty-state"><h2>暂无推荐连接</h2><p>你可以前往高级连接设置注册新的数据来源。</p></section>
  </div>
</template>
