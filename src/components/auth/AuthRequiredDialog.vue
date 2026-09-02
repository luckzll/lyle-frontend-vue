<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { ArrowRight, LogIn, Sparkles, X } from '@lucide/vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import { authGateState, closeAuthGate } from '@/composables/useAuthGate'
import { safeRedirect } from '@/domain/auth-redirect'

const router = useRouter()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const descriptionId = useId()

watch(() => authGateState.open, async (open) => {
  await nextTick()
  if (open && dialog.value && !dialog.value.open) dialog.value.showModal()
  if (!open && dialog.value?.open) dialog.value.close()
}, { immediate: true })

function close() {
  closeAuthGate()
}

function onCancel(event: Event) {
  event.preventDefault()
  close()
}

async function continueToLogin() {
  const target = safeRedirect(authGateState.target)
  close()
  await router.push({ name: 'login', query: { redirect: target } })
}
</script>

<template>
  <dialog
    ref="dialog"
    class="auth-required-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    @cancel="onCancel"
    @close="closeAuthGate"
  >
    <section class="auth-required-card">
      <header>
        <span class="auth-required-icon" aria-hidden="true">
          <Sparkles :size="21" :stroke-width="1.8" />
        </span>
        <button class="auth-required-close" type="button" aria-label="关闭登录提示" @click="close">
          <X :size="18" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </header>

      <div class="auth-required-copy">
        <p class="eyebrow">登录后继续</p>
        <h2 :id="titleId">把刚才的操作继续完成</h2>
        <p :id="descriptionId">
          登录后即可{{ authGateState.actionLabel }}，并自动回到你刚才选择的位置。
        </p>
      </div>

      <div class="auth-required-benefits" aria-label="登录后可用能力">
        <span>保存会话</span>
        <span>同步项目</span>
        <span>使用知识与记忆</span>
      </div>

      <footer>
        <AppButton variant="secondary" @click="close">先随便看看</AppButton>
        <AppButton data-testid="auth-gate-confirm" @click="continueToLogin">
          <LogIn :size="16" :stroke-width="1.9" aria-hidden="true" />
          登录或注册
          <ArrowRight :size="15" :stroke-width="1.9" aria-hidden="true" />
        </AppButton>
      </footer>
    </section>
  </dialog>
</template>

<style scoped>
.auth-required-dialog {
  position: fixed;
  inset: 0;
  width: min(92vw, 440px);
  max-width: none;
  max-height: 90dvh;
  margin: auto;
  overflow: visible;
  border: 0;
  border-radius: var(--radius-xl);
  background: transparent;
  padding: 0;
  color: var(--foreground);
  box-shadow: var(--shadow-dialog);
}

.auth-required-dialog::backdrop {
  background: color-mix(in srgb, var(--backdrop) 88%, transparent);
  backdrop-filter: blur(4px);
}

.auth-required-card {
  display: grid;
  gap: var(--space-5);
  border: 1px solid var(--primary-border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  padding: var(--space-5);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.auth-required-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: var(--radius-lg);
  background: var(--primary-soft);
  color: var(--primary);
}

.auth-required-close {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--muted-foreground);
  padding: 0;
}

.auth-required-close:hover { background: var(--surface-muted); color: var(--foreground); }
.auth-required-copy { display: grid; gap: var(--space-2); }
.auth-required-copy .eyebrow { margin: 0; }
.auth-required-copy h2 { margin: 0; font-size: 22px; letter-spacing: -0.025em; }
.auth-required-copy > p:last-child { margin: 0; color: var(--muted-foreground); line-height: 1.65; }

.auth-required-benefits {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.auth-required-benefits span {
  border: 1px solid var(--border);
  border-radius: var(--lyle-radius-full);
  background: var(--surface-muted);
  color: var(--muted-foreground);
  padding: 0.4rem 0.65rem;
  font-size: 0.74rem;
  font-weight: 650;
}

footer { justify-content: flex-end; }

@media (max-width: 480px) {
  .auth-required-card { padding: var(--space-4); }
  footer { align-items: stretch; flex-direction: column-reverse; }
  footer :deep(button) { width: 100%; }
}
</style>
