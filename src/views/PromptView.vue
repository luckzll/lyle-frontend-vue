<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { activatePrompt, listPrompts, savePrompt } from '@/api/app'
import type { PromptTemplate } from '@/api/types'

const loading = ref(false)
const prompts = ref<PromptTemplate[]>([])
const activePrompt = ref<PromptTemplate | null>(null)
const form = reactive({
  name: 'Lyle Prompt',
  version: `lyle-agent-${new Date().toISOString().slice(0, 10)}`,
  systemPrompt: '你是 Lyle，一个清晰、可靠的 AI 智能体助手。',
  status: 'draft',
  trafficPercent: 100
})

async function refresh() {
  const response = await listPrompts()
  prompts.value = response.data.items
  activePrompt.value = response.data.active || prompts.value.find((item) => item.status === 'active') || null
}

async function save() {
  if (!form.name.trim() || !form.version.trim() || !form.systemPrompt.trim()) return
  loading.value = true
  try {
    await savePrompt({
      name: form.name.trim(),
      version: form.version.trim(),
      systemPrompt: form.systemPrompt.trim(),
      status: form.status,
      trafficPercent: form.trafficPercent
    })
    await refresh()
  } finally {
    loading.value = false
  }
}

async function activate(id: number) {
  loading.value = true
  try {
    await activatePrompt(id)
    await refresh()
  } finally {
    loading.value = false
  }
}

function editPrompt(item: PromptTemplate) {
  form.name = item.name
  form.version = item.version
  form.systemPrompt = item.systemPrompt
  form.status = item.status
  form.trafficPercent = item.trafficPercent
}

onMounted(refresh)
</script>

<template>
  <section class="page">
    <div class="section-title">
      <div>
        <h1>Prompt 管理</h1>
        <p class="muted">管理系统 Prompt 版本，激活后 Writer Agent 会在下一轮回答中使用。</p>
      </div>
      <span class="badge">{{ activePrompt?.version || '默认版本' }}</span>
    </div>

    <div class="grid">
      <section class="item stack">
        <h2>编辑版本</h2>
        <input v-model="form.name" placeholder="名称" />
        <input v-model="form.version" placeholder="版本号，例如 lyle-agent-v2" />
        <textarea v-model="form.systemPrompt" rows="10" placeholder="System Prompt" />
        <div class="row">
          <select v-model="form.status">
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
          <input v-model.number="form.trafficPercent" type="number" min="0" max="100" />
        </div>
        <button :disabled="loading" type="button" @click="save">保存版本</button>
      </section>

      <section class="item stack">
        <h2>当前生效</h2>
        <template v-if="activePrompt">
          <strong>{{ activePrompt.name }}</strong>
          <span class="muted">{{ activePrompt.version }} · {{ activePrompt.status }}</span>
          <p class="prompt-preview">{{ activePrompt.systemPrompt }}</p>
        </template>
        <p v-else class="muted">暂无 active 版本，系统会使用默认 Prompt。</p>
      </section>
    </div>

    <section class="panel item stack">
      <div class="section-title">
        <h2>历史版本</h2>
        <button class="secondary" type="button" @click="refresh">刷新</button>
      </div>
      <article v-for="item in prompts" :key="item.id || item.version" class="item">
        <div class="section-title">
          <div>
            <strong>{{ item.name }}</strong>
            <p class="muted">{{ item.version }} · {{ item.status }} · {{ item.trafficPercent }}%</p>
          </div>
          <div class="row">
            <button class="secondary" type="button" @click="editPrompt(item)">编辑</button>
            <button :disabled="loading || item.status === 'active' || item.id === 0" type="button" @click="activate(item.id)">
              激活
            </button>
          </div>
        </div>
        <p class="prompt-preview">{{ item.systemPrompt }}</p>
      </article>
    </section>
  </section>
</template>
