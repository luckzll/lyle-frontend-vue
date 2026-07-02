<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getMe } from '@/api/app'
import type { User } from '@/api/types'

const user = ref<User | null>(null)

onMounted(async () => {
  const response = await getMe()
  user.value = response.data
})
</script>

<template>
  <section class="page">
    <div>
      <h1>设置</h1>
      <p class="muted">查看当前账号和系统能力。</p>
    </div>

    <div class="grid">
      <article class="item">
        <h2>当前用户</h2>
        <p><strong>{{ user?.username || '-' }}</strong></p>
        <p class="muted">角色: {{ user?.role || '-' }}</p>
        <p class="muted">ID: {{ user?.id || '-' }}</p>
      </article>

      <article class="item">
        <h2>系统能力</h2>
        <div class="memory-row"><strong>鉴权</strong><span>JWT + 内部服务 Token</span></div>
        <div class="memory-row"><strong>记忆</strong><span>Redis / PostgreSQL / Qdrant / Milvus</span></div>
        <div class="memory-row"><strong>知识库</strong><span>MinIO + Qdrant RAG</span></div>
        <div class="memory-row"><strong>迁移</strong><span>Flyway + Alembic</span></div>
      </article>
    </div>
  </section>
</template>
