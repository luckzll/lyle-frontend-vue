<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  getAdminOverview,
  getAiMetrics,
  getAiToolAudit,
  getAiTools,
  listAiConfigs,
  listAuditLogs,
  updateAiConfig
} from '@/api/app'
import type {
  AdminOverview,
  AiConfigItem,
  AiMetricsResponse,
  AiToolAuditItem,
  AiToolItem,
  AuditLog
} from '@/api/types'

const overview = ref<AdminOverview | null>(null)
const auditLogs = ref<AuditLog[]>([])
const aiConfigs = ref<AiConfigItem[]>([])
const aiMetrics = ref<AiMetricsResponse | null>(null)
const aiTools = ref<AiToolItem[]>([])
const toolAudit = ref<AiToolAuditItem[]>([])
const loading = ref(false)
const savingKey = ref('')
const error = ref('')
const notice = ref('')
const activeTab = ref<'overview' | 'config' | 'runtime' | 'tools' | 'audit'>('overview')

const enabledToolCount = computed(() => aiTools.value.filter((tool) => tool.enabled).length)
const failedToolAuditCount = computed(() => toolAudit.value.filter((item) => !item.ok).length)
const modelEntries = computed(() => Object.entries(aiMetrics.value?.models || {}))

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [overviewResponse, logsResponse, configResponse, metricsResponse, toolsResponse, toolAuditResponse] =
      await Promise.all([
        getAdminOverview(),
        listAuditLogs(),
        listAiConfigs(),
        getAiMetrics(),
        getAiTools(),
        getAiToolAudit()
      ])
    overview.value = overviewResponse.data
    auditLogs.value = logsResponse.data.records
    aiConfigs.value = configResponse.data
    aiMetrics.value = metricsResponse.data
    aiTools.value = toolsResponse.data.tools
    toolAudit.value = toolAuditResponse.data.items
  } catch {
    error.value = '管理数据加载失败，请确认后端和 Python AI 服务可用。'
  } finally {
    loading.value = false
  }
}

async function saveConfig(item: AiConfigItem) {
  savingKey.value = item.key
  error.value = ''
  notice.value = ''
  try {
    const response = await updateAiConfig(item.key, item.value)
    const index = aiConfigs.value.findIndex((config) => config.key === item.key)
    if (index >= 0) aiConfigs.value[index] = response.data
    const logsResponse = await listAuditLogs()
    auditLogs.value = logsResponse.data.records
    notice.value = `${item.key} 已保存。`
  } catch {
    error.value = `${item.key} 保存失败。`
  } finally {
    savingKey.value = ''
  }
}

function isBooleanConfig(item: AiConfigItem) {
  return ['true', 'false'].includes(item.value)
}

function stringify(value: unknown) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatSeconds(value?: number) {
  if (value === undefined || value === null) return '-'
  if (value < 60) return `${Math.round(value)}s`
  if (value < 3600) return `${Math.round(value / 60)}m`
  return `${Math.round(value / 3600)}h`
}

function riskText(value?: string) {
  if (value === 'read') return '只读'
  if (value === 'external_read') return '外部读取'
  if (value === 'artifact') return '产物生成'
  if (value === 'write') return '写操作'
  if (value === 'high_risk') return '高风险'
  return value || '未分级'
}

function riskBadgeClass(value?: string) {
  return {
    success: value === 'read',
    pending: value === 'external_read' || value === 'artifact',
    danger: value === 'write' || value === 'high_risk'
  }
}

onMounted(refresh)
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>管理</h1>
        <p class="muted">系统状态、AI 配置、工具审计和操作日志。</p>
      </div>
      <button data-testid="admin-refresh-button" :disabled="loading" type="button" @click="refresh">
        {{ loading ? '刷新中' : '刷新' }}
      </button>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="notice" class="alert success">{{ notice }}</p>

    <div class="segmented admin-tabs">
      <button type="button" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">总览</button>
      <button type="button" :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">AI 配置</button>
      <button type="button" :class="{ active: activeTab === 'runtime' }" @click="activeTab = 'runtime'">运行状态</button>
      <button type="button" :class="{ active: activeTab === 'tools' }" @click="activeTab = 'tools'">工具</button>
      <button type="button" :class="{ active: activeTab === 'audit' }" @click="activeTab = 'audit'">审计</button>
    </div>

    <div v-if="loading" class="empty-state compact">
      <strong>正在加载管理数据</strong>
      <span>请稍候。</span>
    </div>

    <section v-if="activeTab === 'overview'" class="stack">
      <div class="grid">
        <article class="item">
          <h2>用户</h2>
          <p class="metric">{{ overview?.users ?? '-' }}</p>
        </article>
        <article class="item">
          <h2>会话</h2>
          <p class="metric">{{ overview?.conversations ?? '-' }}</p>
        </article>
        <article class="item">
          <h2>知识库</h2>
          <p class="metric">{{ overview?.knowledgeBases ?? '-' }}</p>
        </article>
        <article class="item">
          <h2>文件</h2>
          <p class="metric">{{ overview?.knowledgeFiles ?? '-' }}</p>
        </article>
      </div>

      <div class="grid">
        <article class="item">
          <h2>AI 服务</h2>
          <div class="status-grid">
            <div>
              <strong>运行时间</strong>
              <span>{{ formatSeconds(aiMetrics?.uptime_seconds) }}</span>
            </div>
            <div>
              <strong>模型任务</strong>
              <span>{{ modelEntries.length }}</span>
            </div>
            <div>
              <strong>启用工具</strong>
              <span>{{ enabledToolCount }}/{{ aiTools.length }}</span>
            </div>
            <div>
              <strong>工具失败</strong>
              <span>{{ failedToolAuditCount }}</span>
            </div>
          </div>
        </article>

        <article class="item">
          <h2>最近审计</h2>
          <p v-if="auditLogs.length === 0" class="muted">暂无审计日志。</p>
          <div v-for="item in auditLogs.slice(0, 5)" :key="item.id" class="memory-row stacked">
            <strong>{{ item.action }}</strong>
            <span>{{ item.target }} / {{ item.targetId }} · 用户 {{ item.userId }}</span>
            <small class="memory-meta">{{ item.createdAt }}</small>
          </div>
        </article>
      </div>
    </section>

    <section v-if="activeTab === 'config'" class="item stack">
      <div class="section-title">
        <div>
          <h2>AI 配置</h2>
          <p class="muted">配置保存在 Java 业务库，每次聊天会随请求热同步到 Python。</p>
        </div>
        <span class="badge">{{ aiConfigs.length }} 项</span>
      </div>

      <div v-if="aiConfigs.length === 0" class="empty-state compact">
        <strong>暂无配置</strong>
        <span>刷新后仍为空时，请检查数据库初始化。</span>
      </div>

      <div v-for="item in aiConfigs" :key="item.key" class="config-row">
        <div>
          <strong>{{ item.key }}</strong>
          <p class="muted">{{ item.description }}</p>
          <small class="memory-meta">{{ item.updatedAt }}</small>
        </div>
        <div class="config-control">
          <select v-if="isBooleanConfig(item)" v-model="item.value">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <input v-else v-model="item.value" />
          <button type="button" :disabled="savingKey === item.key" @click="saveConfig(item)">
            {{ savingKey === item.key ? '保存中' : '保存' }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'runtime'" class="grid">
      <article class="item stack">
        <h2>运行特性</h2>
        <div class="status-grid">
          <div>
            <strong>运行时间</strong>
            <span>{{ formatSeconds(aiMetrics?.uptime_seconds) }}</span>
          </div>
          <div>
            <strong>Agent 图</strong>
            <span>{{ stringify(aiMetrics?.features?.agent_graph) }}</span>
          </div>
          <div>
            <strong>Reviewer</strong>
            <span>{{ stringify(aiMetrics?.features?.reviewer_enabled) }}</span>
          </div>
          <div>
            <strong>Reranker</strong>
            <span>{{ stringify(aiMetrics?.features?.rerank_enabled) }}</span>
          </div>
        </div>
      </article>

      <article class="item stack">
        <h2>模型路由</h2>
        <p v-if="modelEntries.length === 0" class="muted">暂无模型信息。</p>
        <div v-for="[key, item] in modelEntries" :key="key" class="memory-row stacked">
          <strong>{{ key }}</strong>
          <span>{{ item.model }}</span>
          <small class="memory-meta">provider={{ item.provider }}</small>
        </div>
      </article>

      <article class="item stack">
        <h2>限制和工具状态</h2>
        <pre>{{ JSON.stringify({ limits: aiMetrics?.limits || {}, tools: aiMetrics?.tools || {} }, null, 2) }}</pre>
      </article>
    </section>

    <section v-if="activeTab === 'tools'" class="grid">
      <article class="item stack">
        <div class="section-title">
          <h2>AI 工具</h2>
          <span class="badge">{{ enabledToolCount }} 个启用</span>
        </div>
        <p v-if="aiTools.length === 0" class="muted">暂无工具信息。</p>
        <div v-for="tool in aiTools" :key="tool.name" class="tool-row">
          <div>
            <strong>{{ tool.name }}</strong>
            <p class="muted">{{ tool.description }}</p>
            <small class="memory-meta">
              {{ tool.riskDescription || '暂无风险说明' }}
            </small>
          </div>
          <div class="tool-badges">
            <span class="badge" :class="riskBadgeClass(tool.riskLevel)">
              {{ riskText(tool.riskLevel) }}
            </span>
            <span v-if="tool.requiresConfirmation" class="badge pending">需确认</span>
            <span class="badge" :class="{ success: tool.enabled, danger: !tool.enabled }">
              {{ tool.enabled ? '启用' : '关闭' }}
            </span>
          </div>
        </div>
      </article>

      <article class="item stack">
        <div class="section-title">
          <h2>工具审计</h2>
          <span class="badge" :class="{ danger: failedToolAuditCount > 0 }">{{ failedToolAuditCount }} 个失败</span>
        </div>
        <p v-if="toolAudit.length === 0" class="muted">暂无工具调用。</p>
        <div v-for="item in toolAudit" :key="item.id" class="memory-row stacked">
          <strong>{{ item.toolName }} · {{ item.ok ? '成功' : '失败' }}</strong>
          <span>用户 {{ item.userId }} · {{ item.elapsedMs }}ms</span>
          <small class="memory-meta">{{ item.createdAt }}</small>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'audit'" class="item stack">
      <div class="section-title">
        <h2>审计日志</h2>
        <span class="badge">{{ auditLogs.length }} 条</span>
      </div>
      <div v-if="auditLogs.length === 0" class="empty-state compact">
        <strong>暂无审计日志</strong>
        <span>配置、上传、删除等操作会在这里出现。</span>
      </div>
      <div v-for="item in auditLogs" :key="item.id" class="audit-row">
        <strong>{{ item.action }}</strong>
        <span>{{ item.target }} / {{ item.targetId }}</span>
        <span>用户 {{ item.userId }}</span>
        <small>{{ item.createdAt }}</small>
      </div>
    </section>
  </section>
</template>
