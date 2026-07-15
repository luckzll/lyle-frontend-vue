<script setup lang="ts">
import { ArrowLeft, LayoutDashboard, MessageSquareText, SearchX } from '@lucide/vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'

const router = useRouter()

function goBack() {
  if (window.history.length > 1) {
    router.back()
    return
  }
  void router.push('/dashboard')
}
</script>

<template>
  <section class="not-found-page" data-testid="not-found-page">
    <div class="not-found-card">
      <span class="illustration" aria-hidden="true"><SearchX :size="30" /></span>
      <p class="eyebrow">页面未找到</p>
      <h1>这里暂时没有内容</h1>
      <p class="description">地址可能已经更新，也可能输入有误。你的工作内容没有丢失，可以返回工作台继续。</p>
      <div class="actions">
        <AppButton variant="secondary" @click="goBack"><ArrowLeft :size="16" />返回上一页</AppButton>
        <RouterLink class="primary-link" to="/dashboard"><LayoutDashboard :size="16" />前往工作台</RouterLink>
      </div>
      <RouterLink class="chat-link" to="/"><MessageSquareText :size="15" />或者开始一段新对话</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.not-found-page { display: grid; min-height: min(70vh, 680px); place-items: center; padding: var(--space-8) var(--space-4); }
.not-found-card { display: grid; width: min(100%, 560px); justify-items: center; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-card); padding: clamp(32px, 7vw, 64px); text-align: center; }
.illustration { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 20px; background: var(--primary-soft); color: var(--primary); }
.eyebrow { margin: var(--space-5) 0 var(--space-2); color: var(--primary); font-size: 13px; font-weight: 750; letter-spacing: .04em; }
h1 { margin: 0; color: var(--foreground); font-size: clamp(28px, 5vw, 40px); letter-spacing: -.035em; }
.description { max-width: 440px; margin: var(--space-3) 0 0; color: var(--muted-foreground); line-height: 1.7; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-6); }
.actions :deep(button), .primary-link { min-height: 40px; }
.primary-link { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); border-radius: var(--radius-md); background: var(--primary); color: var(--primary-foreground); padding: 9px 14px; font-weight: 650; }
.primary-link:hover { background: var(--primary-hover); }
.chat-link { display: inline-flex; align-items: center; gap: 6px; margin-top: var(--space-5); color: var(--muted-foreground); font-size: 13px; }
.chat-link:hover { color: var(--primary); }
@media (max-width: 520px) { .not-found-page { min-height: 60vh; padding: var(--space-4) 0; } .not-found-card { border-radius: var(--radius-lg); padding: 32px 20px; } .actions { width: 100%; flex-direction: column-reverse; } .actions :deep(button), .primary-link { width: 100%; } }
</style>
