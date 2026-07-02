<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createConversation, deleteConversation, listConversations } from '@/api/app'
import type { Conversation } from '@/api/types'

const title = ref('默认会话')
const conversations = ref<Conversation[]>([])

async function refresh() {
  const response = await listConversations()
  conversations.value = response.data
}

async function create() {
  if (!title.value.trim()) return
  await createConversation(title.value.trim())
  title.value = ''
  await refresh()
}

async function remove(id: string) {
  await deleteConversation(id)
  await refresh()
}

onMounted(refresh)
</script>

<template>
  <section class="page">
    <div>
      <h1>会话</h1>
      <p class="muted">查看和创建聊天会话。</p>
    </div>

    <div class="panel item">
      <div class="row">
        <input v-model="title" placeholder="会话标题" />
        <button @click="create">创建</button>
      </div>
    </div>

    <div class="grid">
      <article v-for="item in conversations" :key="item.id" class="item">
        <h2>{{ item.title }}</h2>
        <p class="muted">ID: {{ item.id }}</p>
        <div class="row">
          <RouterLink class="button-link" :to="{ name: 'chat' }">打开聊天</RouterLink>
          <button class="secondary danger" type="button" @click="remove(item.id)">删除</button>
        </div>
      </article>
    </div>
  </section>
</template>
