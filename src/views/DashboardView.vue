<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { generateDailyBriefing, generateEveningBriefing, generateWeeklyBriefing, getTodayBriefing } from '@/api/app'
import type { DailyBriefing } from '@/api/types'

const briefing = ref<DailyBriefing | null>(null)
const loading = ref(false)
const error = ref('')
const briefingMode = ref<'daily' | 'evening' | 'weekly'>('daily')

onMounted(refresh)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await getTodayBriefing()
    briefing.value = response.data
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : '今日简报加载失败'
  } finally {
    loading.value = false
  }
}

async function saveBriefing() {
  loading.value = true
  error.value = ''
  try {
    const projectId = briefing.value?.projectId || undefined
    const response = briefingMode.value === 'weekly'
      ? await generateWeeklyBriefing(projectId)
      : briefingMode.value === 'evening'
        ? await generateEveningBriefing(projectId)
        : await generateDailyBriefing(projectId)
    briefing.value = response.data
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : '生成简报或复盘失败'
  } finally {
    loading.value = false
  }
}

function modeText(mode: string) {
  return {
    daily: '今日简报',
    evening: '晚间复盘',
    weekly: '每周复盘'
  }[mode] ?? mode
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>工作台</h1>
        <p class="muted">今日重点、项目进展和待确认事项。</p>
      </div>
      <span class="row">
        <span class="segmented compact">
          <button :class="{ active: briefingMode === 'daily' }" type="button" @click="briefingMode = 'daily'">今日</button>
          <button :class="{ active: briefingMode === 'evening' }" type="button" @click="briefingMode = 'evening'">晚间</button>
          <button :class="{ active: briefingMode === 'weekly' }" type="button" @click="briefingMode = 'weekly'">每周</button>
        </span>
        <button class="secondary" :disabled="loading" type="button" @click="refresh">刷新</button>
        <button :disabled="loading" type="button" @click="saveBriefing">生成{{ modeText(briefingMode) }}</button>
      </span>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>

    <div v-if="briefing" class="home-brief">
      <div class="brief-metrics">
        <RouterLink class="brief-metric" to="/projects">
          <strong>{{ briefing.projects.length }}</strong>
          <span>活跃项目</span>
        </RouterLink>
        <RouterLink class="brief-metric" to="/projects">
          <strong>{{ briefing.goals.length }}</strong>
          <span>进行中目标</span>
        </RouterLink>
        <RouterLink class="brief-metric pending" to="/tasks">
          <strong>{{ briefing.dueTasks.length }}</strong>
          <span>今日到期</span>
        </RouterLink>
        <RouterLink class="brief-metric danger" to="/tasks">
          <strong>{{ briefing.overdueTasks.length }}</strong>
          <span>已逾期</span>
        </RouterLink>
        <RouterLink class="brief-metric" to="/operations">
          <strong>{{ briefing.pendingOperations.length }}</strong>
          <span>待确认操作</span>
        </RouterLink>
      </div>

      <article class="brief-focus">
        <div class="section-title">
          <h2>今日重点</h2>
          <span class="badge">{{ briefing.briefingType }}</span>
        </div>
        <div v-if="briefing.todayFocus.length" class="stack">
          <div v-for="item in briefing.todayFocus" :key="item" class="brief-focus-item">
            <strong>{{ item }}</strong>
            <span>来自任务、目标和待确认操作</span>
          </div>
        </div>
        <p v-else class="muted">暂无重点建议。</p>
      </article>

      <article class="brief-focus">
        <h2>当前项目</h2>
        <RouterLink
          v-for="project in briefing.projects.slice(0, 5)"
          :key="project.id"
          class="brief-focus-item"
          :to="`/projects/${project.id}`"
        >
          <strong>{{ project.name }}</strong>
          <span>{{ project.currentStage || '未设置阶段' }}</span>
        </RouterLink>
        <p v-if="briefing.projects.length === 0" class="muted">暂无活跃项目。</p>
      </article>

      <article class="brief-focus">
        <h2>简报内容</h2>
        <pre>{{ briefing.content }}</pre>
      </article>
    </div>

    <div v-else class="empty-state">
      <strong>{{ loading ? '正在加载工作台' : '暂无简报' }}</strong>
      <span>生成今日简报后，这里会展示项目重点。</span>
    </div>
  </section>
</template>
