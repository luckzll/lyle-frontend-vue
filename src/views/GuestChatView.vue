<script setup lang="ts">
import { ArrowUp, LockKeyhole, PanelRightOpen, Sparkles } from '@lucide/vue'
import SuggestionCard from '@/components/domain/SuggestionCard.vue'
import { requestAuth } from '@/composables/useAuthGate'

const starterPrompts = [
  { title: '整理项目', description: '归纳目标、进展、风险和下一步' },
  { title: '生成计划', description: '把目标拆成今天可开始的行动' },
  { title: '查询资料', description: '整理关键信息并标明来源' },
  { title: '运行巡检', description: '优先指出风险、阻塞和建议动作' }
]

function requireLogin(actionLabel: string) {
  requestAuth('/', actionLabel)
}
</script>

<template>
  <section class="page guest-chat-page" data-testid="guest-chat-preview">
    <div class="toolbar guest-chat-toolbar">
      <div>
        <div class="guest-chat-title-line">
          <h1>AI 聊天</h1>
          <span><LockKeyhole :size="12" aria-hidden="true" /> 访客预览</span>
        </div>
        <p class="muted">新会话 · 未使用知识库</p>
      </div>
      <div class="row guest-chat-toolbar-actions">
        <button class="secondary context-toggle" type="button" @click="requireLogin('查看当前上下文')">
          <PanelRightOpen :size="16" aria-hidden="true" />
          当前上下文
        </button>
        <button class="secondary" type="button" @click="requireLogin('新建会话')">新建</button>
      </div>
    </div>

    <div class="guest-chat-workspace">
      <main class="guest-chat-starter" aria-labelledby="guest-chat-starter-title">
        <div>
          <p class="eyebrow">从一项具体工作开始</p>
          <h2 id="guest-chat-starter-title">今天想推进什么？</h2>
          <p class="muted">选择一个常用入口，或直接在下方描述你想得到的结果。</p>
        </div>
        <div class="guest-starter-grid">
          <SuggestionCard
            v-for="starter in starterPrompts"
            :key="starter.title"
            :title="starter.title"
            :description="starter.description"
            compact
            @select="requireLogin(`使用“${starter.title}”`)">
          </SuggestionCard>
        </div>
      </main>

      <button
        class="guest-composer"
        type="button"
        aria-label="登录后输入消息"
        data-testid="guest-chat-composer"
        @click="requireLogin('开始 AI 对话')"
      >
        <span class="guest-composer-placeholder">输入消息，或拖入文件</span>
        <span class="guest-composer-bottom">
          <span class="guest-composer-hint">可拖入图片、文件或文件夹</span>
          <span class="guest-model-pill"><Sparkles :size="15" aria-hidden="true" /> GPT-5.5</span>
          <span class="guest-context-copy">当前项目 / 知识库</span>
          <span class="guest-send" aria-hidden="true"><ArrowUp :size="20" :stroke-width="2" /></span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.guest-chat-page { --guest-chat-reading-width: 920px; }
.guest-chat-toolbar { width: min(100%, var(--guest-chat-reading-width)); margin-inline: auto; }
.guest-chat-title-line { display: flex; align-items: center; gap: var(--space-2); }
.guest-chat-title-line h1 { margin: 0; }
.guest-chat-title-line span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--primary-border);
  border-radius: var(--lyle-radius-full);
  background: var(--primary-soft);
  color: var(--primary);
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 750;
}
.guest-chat-toolbar p { margin: 4px 0 0; }
.guest-chat-toolbar-actions { align-items: center; }
.context-toggle { display: inline-flex; align-items: center; gap: 6px; }

.guest-chat-workspace {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--space-4);
}

.guest-chat-starter {
  display: grid;
  width: min(780px, 100%);
  min-height: 0;
  align-self: center;
  justify-self: center;
  gap: var(--space-5);
  overflow-y: auto;
  padding: clamp(16px, 4vw, 42px) 0;
  scrollbar-width: none;
}
.guest-chat-starter::-webkit-scrollbar { display: none; }

.guest-chat-starter h2 { margin: 0; font-size: clamp(22px, 3vw, 30px); }
.guest-chat-starter p { margin: 6px 0 0; }
.guest-starter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }

.guest-composer {
  position: sticky;
  bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
  display: grid;
  width: min(100%, var(--guest-chat-reading-width));
  min-height: 112px;
  justify-self: center;
  grid-template-rows: 1fr auto;
  gap: var(--space-3);
  border: 1px solid var(--primary-border);
  border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  color: var(--foreground);
  padding: var(--space-4);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 10%, transparent), var(--shadow-popover);
  text-align: left;
  backdrop-filter: blur(12px);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}

.guest-composer:hover {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent), var(--shadow-popover);
  transform: translateY(-1px);
}

.guest-composer:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
.guest-composer-placeholder { color: var(--muted-foreground); font-size: 15px; font-weight: 450; }
.guest-composer-bottom { display: flex; align-items: center; gap: var(--space-3); }
.guest-composer-hint,
.guest-context-copy { color: var(--muted-foreground); font-size: 12px; }
.guest-composer-hint { margin-right: auto; }
.guest-model-pill {
  display: inline-flex;
  min-width: 154px;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: var(--radius-md);
  background: var(--primary-soft);
  color: var(--foreground);
  font-size: 12px;
  font-weight: 750;
}
.guest-model-pill svg { color: var(--primary); }
.guest-context-copy { padding-left: var(--space-3); border-left: 1px solid var(--border); }
.guest-send {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: var(--lyle-radius-full);
  background: var(--primary);
  color: var(--primary-foreground);
}

@media (max-width: 640px) {
  .guest-chat-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
  .guest-chat-toolbar-actions { flex-wrap: nowrap; }
  .guest-chat-toolbar-actions .context-toggle { width: 40px; height: 40px; flex: 0 0 40px; overflow: hidden; color: transparent; gap: 0; padding: 0; font-size: 0; }
  .guest-chat-toolbar-actions .context-toggle svg { color: var(--foreground); flex: 0 0 auto; }
  .guest-chat-starter { align-self: start; gap: var(--space-3); padding: var(--space-2) 0 var(--space-4); }
  .guest-starter-grid { grid-template-columns: 1fr; gap: var(--space-2); }
  .guest-composer { min-height: 104px; padding: var(--space-3); }
  .guest-composer-bottom { gap: var(--space-2); }
  .guest-composer-hint,
  .guest-context-copy { display: none; }
  .guest-model-pill { min-width: 0; margin-right: auto; padding: 0 var(--space-3); }
}

@media (prefers-reduced-motion: reduce) {
  .guest-composer:hover { transform: none; }
}
</style>
