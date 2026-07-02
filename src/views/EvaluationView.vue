<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  evaluateBatch,
  deleteEvaluationSet,
  getEvaluationRun,
  getEvaluationRunReport,
  getEvaluationTrends,
  getEvaluationSet,
  listEvaluationRuns,
  listEvaluationSets,
  runEvaluationSet,
  saveEvaluationSet,
  updateEvaluationSet
} from '@/api/app'
import type {
  EvaluationBatchResultItem,
  EvaluationCase,
  EvaluationRunItem,
  EvaluationSetItem,
  EvaluationTrendResponse
} from '@/api/types'

const cases = ref<EvaluationCase[]>([
  {
    id: 'case-1',
    question: '这个回答是否清楚？',
    answer: '这是一个用于评测的示例回答。',
    contexts: [],
    mustInclude: [],
    mustNotInclude: []
  }
])
const results = ref<EvaluationBatchResultItem[]>([])
const runs = ref<EvaluationRunItem[]>([])
const sets = ref<EvaluationSetItem[]>([])
const trends = ref<EvaluationTrendResponse>({
  points: [],
  promptCompare: [],
  modelCompare: []
})
const averageScore = ref<number | null>(null)
const runName = ref('手动批量评测')
const setDescription = ref('')
const selectedSetId = ref<number | null>(null)
const loading = ref(false)
const historyLoading = ref(false)
const setLoading = ref(false)

const badcases = computed(() => results.value.filter((item) => item.score < 0.7))

onMounted(async () => {
  await Promise.all([refreshRuns(), refreshSets(), refreshTrends()])
})

function addCase() {
  cases.value.push({
    id: `case-${cases.value.length + 1}`,
    question: '',
    answer: '',
    contexts: [],
    mustInclude: [],
    mustNotInclude: []
  })
}

function removeCase(index: number) {
  cases.value.splice(index, 1)
}

async function runEvaluation() {
  loading.value = true
  try {
    const response = await evaluateBatch(
      cases.value.filter((item) => item.question.trim() && item.answer.trim()),
      runName.value
    )
    results.value = response.data.items
    averageScore.value = response.data.averageScore
    await refreshRuns()
    await refreshTrends()
  } finally {
    loading.value = false
  }
}

async function saveSet() {
  const validCases = cases.value.filter((item) => item.question.trim() && item.answer.trim())
  if (!runName.value.trim() || validCases.length === 0) return
  setLoading.value = true
  try {
    const response = selectedSetId.value
      ? await updateEvaluationSet(selectedSetId.value, runName.value.trim(), setDescription.value, validCases)
      : await saveEvaluationSet(runName.value.trim(), setDescription.value, validCases)
    selectedSetId.value = response.data.id
    await refreshSets()
  } finally {
    setLoading.value = false
  }
}

async function removeSet(setId: number) {
  await deleteEvaluationSet(setId)
  if (selectedSetId.value === setId) {
    selectedSetId.value = null
  }
  await refreshSets()
}

async function loadSet(setId: number) {
  const response = await getEvaluationSet(setId)
  selectedSetId.value = response.data.id
  runName.value = response.data.name
  setDescription.value = response.data.description
  cases.value = response.data.cases.length ? response.data.cases : cases.value
}

async function runSelectedSet(badcasesOnly = false) {
  if (!selectedSetId.value) return
  loading.value = true
  try {
    const response = await runEvaluationSet(selectedSetId.value, badcasesOnly)
    results.value = response.data.items
    averageScore.value = response.data.averageScore
    await refreshRuns()
    await refreshTrends()
  } finally {
    loading.value = false
  }
}

async function refreshRuns() {
  historyLoading.value = true
  try {
    const response = await listEvaluationRuns(20)
    runs.value = response.data.items
  } finally {
    historyLoading.value = false
  }
}

async function refreshTrends() {
  const response = await getEvaluationTrends(50)
  trends.value = response.data
}

async function refreshSets() {
  setLoading.value = true
  try {
    const response = await listEvaluationSets(20)
    sets.value = response.data.items
  } finally {
    setLoading.value = false
  }
}

async function loadRun(runId: number) {
  const response = await getEvaluationRun(runId)
  results.value = response.data.items || []
  averageScore.value = response.data.averageScore
}

async function downloadRunReport(runId: number) {
  const response = await getEvaluationRunReport(runId)
  const blob = new Blob([response.data.markdown || ''], { type: response.data.contentType || 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = response.data.fileName || `evaluation-run-${runId}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function barWidth(score: number) {
  return `${Math.max(2, Math.min(100, Math.round(score * 100)))}%`
}

function updateKeywordList(index: number, field: 'mustInclude' | 'mustNotInclude', value: string) {
  cases.value[index][field] = value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function dimensionEntries(item: EvaluationBatchResultItem) {
  return Object.entries(item.dimensions || (item.checks.dimensions as Record<string, number> | undefined) || {})
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>评测</h1>
        <p class="muted">批量评估回答质量，保存历史记录，用于模型和 Prompt 对比。</p>
      </div>
      <div class="row">
        <button class="secondary" :disabled="setLoading" type="button" @click="saveSet">
          {{ selectedSetId ? '更新评测集' : '保存评测集' }}
        </button>
        <button class="secondary" :disabled="loading || !selectedSetId" type="button" @click="runSelectedSet(false)">运行评测集</button>
        <button class="secondary" :disabled="loading || !selectedSetId" type="button" @click="runSelectedSet(true)">复测 Badcase</button>
        <button class="secondary" :disabled="historyLoading" type="button" @click="refreshRuns">刷新历史</button>
        <button class="secondary" type="button" @click="addCase">新增 Case</button>
        <button :disabled="loading" type="button" @click="runEvaluation">开始评测</button>
      </div>
    </div>

    <article class="item">
      <h2>评测集</h2>
      <div class="form-line">
        <label>评测名称</label>
        <input v-model="runName" placeholder="例如：RAG Prompt v2 对比" />
      </div>
      <div class="form-line">
        <label>评测集说明</label>
        <textarea v-model="setDescription" rows="2" placeholder="说明这个评测集覆盖的场景"></textarea>
      </div>
      <div v-for="(item, index) in cases" :key="index" class="eval-case">
        <div class="row">
          <input v-model="item.id" placeholder="Case ID" />
          <button class="secondary" type="button" @click="removeCase(index)">移除</button>
        </div>
        <textarea v-model="item.question" rows="2" placeholder="用户问题"></textarea>
        <textarea v-model="item.answer" rows="4" placeholder="模型回答"></textarea>
        <textarea v-model="item.expectedAnswer" rows="2" placeholder="期望答案，可选"></textarea>
        <div class="row">
          <input v-model="item.type" placeholder="类型，例如 rag / memory / tool / chat" />
          <input
            :value="(item.mustInclude || []).join('，')"
            placeholder="必须包含，逗号分隔"
            @input="updateKeywordList(index, 'mustInclude', ($event.target as HTMLInputElement).value)"
          />
          <input
            :value="(item.mustNotInclude || []).join('，')"
            placeholder="不得包含，逗号分隔"
            @input="updateKeywordList(index, 'mustNotInclude', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <textarea v-model="item.rubric" rows="2" placeholder="评测规则，可选"></textarea>
      </div>
    </article>

    <article class="item">
      <h2>评测集管理</h2>
      <p v-if="sets.length === 0" class="muted">暂无评测集。</p>
      <div v-for="item in sets" :key="item.id" class="memory-row stacked">
        <strong>{{ item.name }} · {{ item.caseCount }} 个 Case</strong>
        <span>{{ item.description || '无说明' }}</span>
        <small class="memory-meta">{{ item.updatedAt }}</small>
        <span class="row">
          <button class="inline" type="button" @click="loadSet(item.id)">加载</button>
          <button class="inline secondary" type="button" @click="selectedSetId = item.id; runSelectedSet(false)">运行</button>
          <button class="inline secondary" type="button" @click="selectedSetId = item.id; runSelectedSet(true)">复测 Badcase</button>
          <button class="inline danger" type="button" @click="removeSet(item.id)">删除</button>
        </span>
      </div>
    </article>

    <article class="item">
      <h2>结果</h2>
      <div class="status-grid">
        <div>
          <span class="metric">{{ averageScore === null ? '-' : averageScore }}</span>
          <span class="muted">平均分</span>
        </div>
        <div>
          <span class="metric">{{ results.length }}</span>
          <span class="muted">评测 Case</span>
        </div>
        <div>
          <span class="metric">{{ badcases.length }}</span>
          <span class="muted">Badcase</span>
        </div>
      </div>
      <div v-for="item in results" :key="item.id" class="memory-row stacked">
        <strong>{{ item.id }} · {{ item.score }}</strong>
        <span>{{ item.question }}</span>
        <span v-if="item.answer">{{ item.answer }}</span>
        <span v-if="item.reason" class="muted">{{ item.reason }}</span>
        <div v-if="dimensionEntries(item).length" class="dimension-grid">
          <span v-for="[name, value] in dimensionEntries(item)" :key="name">
            {{ name }} {{ value }}
          </span>
        </div>
        <span v-if="item.score < 0.7" class="badge danger">badcase</span>
        <small class="memory-meta">
          Prompt: {{ item.promptVersion }} · {{ item.scoringMode || item.checks.scoring_mode || 'heuristic' }}
        </small>
      </div>
    </article>

    <article class="item">
      <div class="section-title">
        <h2>趋势与对比</h2>
        <button class="secondary" type="button" @click="refreshTrends">刷新趋势</button>
      </div>
      <div class="grid">
        <section class="stack">
          <h3>最近评测趋势</h3>
          <p v-if="trends.points.length === 0" class="muted">暂无趋势数据。</p>
          <div v-for="point in trends.points" :key="point.id" class="trend-row">
            <span>{{ point.name }}</span>
            <div class="trend-bar"><i :style="{ width: barWidth(point.averageScore) }"></i></div>
            <strong>{{ point.averageScore }}</strong>
          </div>
        </section>
        <section class="stack">
          <h3>Prompt 对比</h3>
          <div v-for="item in trends.promptCompare" :key="item.name" class="trend-row">
            <span>{{ item.name }}</span>
            <div class="trend-bar"><i :style="{ width: barWidth(item.averageScore) }"></i></div>
            <strong>{{ item.averageScore }}</strong>
          </div>
        </section>
        <section class="stack">
          <h3>模型对比</h3>
          <div v-for="item in trends.modelCompare" :key="item.name" class="trend-row">
            <span>{{ item.name }}</span>
            <div class="trend-bar"><i :style="{ width: barWidth(item.averageScore) }"></i></div>
            <strong>{{ item.averageScore }}</strong>
          </div>
        </section>
      </div>
    </article>

    <article class="item">
      <h2>历史评测</h2>
      <p v-if="runs.length === 0" class="muted">暂无历史评测。</p>
      <div v-for="item in runs" :key="item.id" class="memory-row stacked">
        <strong>{{ item.name }} · {{ item.averageScore }}</strong>
        <span>{{ item.count }} 个 Case · Badcase {{ item.badcaseCount || 0 }} · {{ item.modelProvider }}/{{ item.modelName }}</span>
        <small class="memory-meta">{{ item.promptVersion }} · {{ item.createdAt }}</small>
        <span class="row">
          <button class="inline" type="button" @click="loadRun(item.id)">查看结果</button>
          <button class="inline secondary" type="button" @click="downloadRunReport(item.id)">导出报告</button>
        </span>
      </div>
    </article>
  </section>
</template>
