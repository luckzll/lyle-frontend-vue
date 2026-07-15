<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, register } from '@/api/app'
import { setAuth } from '@/auth'

const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const username = ref('demo')
const password = ref('123456')
const loading = ref(false)
const errorMessage = ref('')

async function submit() {
  if (!username.value.trim() || !password.value.trim() || loading.value) return

  loading.value = true
  errorMessage.value = ''
  try {
    const request = mode.value === 'login' ? login : register
    const response = await request(username.value.trim(), password.value)
    setAuth(response.data.user, response.data.token)
    await router.push('/dashboard')
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.message || error?.response?.data?.detail || '登录失败，请检查账号密码。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <div>
        <h1>Lyle AI</h1>
        <p class="muted">登录后开始使用智能体、知识库和会话历史。</p>
      </div>

      <div class="tabs">
        <button data-testid="login-tab" :class="{ secondary: mode !== 'login' }" type="button" @click="mode = 'login'">登录</button>
        <button data-testid="register-tab" :class="{ secondary: mode !== 'register' }" type="button" @click="mode = 'register'">注册</button>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <input v-model="username" autocomplete="username" data-testid="username-input" placeholder="用户名" />
        <input v-model="password" autocomplete="current-password" data-testid="password-input" placeholder="密码" type="password" />
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <button data-testid="auth-submit" :disabled="loading" type="submit">
          {{ loading ? '处理中...' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>
    </section>
  </main>
</template>
