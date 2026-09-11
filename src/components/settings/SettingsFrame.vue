<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, BarChart3, ShieldCheck, UserRound, WalletCards } from '@lucide/vue'
import { authState } from '@/auth'
import { getSettingsReturnPath } from '@/app/settings-navigation'

const route = useRoute()
const router = useRouter()
const sections = [
  { to: '/settings', label: '账号与安全', icon: ShieldCheck },
  { to: '/settings/usage', label: 'AI 用量', icon: BarChart3 },
  { to: '/settings/billing', label: '套餐与账单', icon: WalletCards }
]
const activeSection = computed(() => route.name === 'pricing' || route.path === '/pricing' || route.path.startsWith('/settings/billing')
  ? '/settings/billing'
  : route.path === '/settings/usage' ? '/settings/usage' : '/settings')
const returnPath = computed(() => {
  // Re-resolve after navigation or an account change; settings tabs keep one return destination.
  void route.fullPath
  void authState.user?.id
  return getSettingsReturnPath()
})
const accountName = computed(() => authState.user?.username || '个人账号')

function changeSection(event: Event) {
  const target = (event.target as HTMLSelectElement).value
  if (sections.some(section => section.to === target)) void router.push(target)
}
</script>

<template>
  <section class="settings-frame">
    <aside class="settings-frame__nav" aria-label="设置分类">
      <div class="settings-frame__top">
        <RouterLink class="settings-frame__back" :to="returnPath">
          <ArrowLeft :size="19" :stroke-width="1.8" aria-hidden="true" />
          <span>返回应用</span>
        </RouterLink>
        <h1>设置</h1>
      </div>

      <div class="settings-frame__desktop-navigation">
        <p class="settings-frame__group-label">个人</p>
        <nav aria-label="设置导航">
          <RouterLink
            v-for="section in sections"
            :key="section.to"
            :to="section.to"
            :class="{ 'is-active': activeSection === section.to }"
            :aria-current="activeSection === section.to ? 'page' : undefined"
          >
            <component :is="section.icon" :size="19" :stroke-width="1.8" aria-hidden="true" />
            <span>{{ section.label }}</span>
          </RouterLink>
        </nav>
      </div>

      <label class="settings-frame__mobile-selector">
        <span class="settings-frame__sr-only">设置分类</span>
        <select :value="activeSection" @change="changeSection">
          <option v-for="section in sections" :key="section.to" :value="section.to">{{ section.label }}</option>
        </select>
      </label>

      <div class="settings-frame__account">
        <span class="settings-frame__account-icon"><UserRound :size="19" aria-hidden="true" /></span>
        <span><strong>{{ accountName }}</strong><small>Lyle AI · 个人账号</small></span>
      </div>
    </aside>
    <div class="settings-frame__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-frame {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  align-items: start;
  width: 100%;
  min-width: 0;
  min-height: 100dvh;
  background: var(--surface-muted);
}
.settings-frame__nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100dvh;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 24px 16px 20px;
}
.settings-frame__top { display: flex; flex-direction: column; gap: 30px; }
.settings-frame__back {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 10px;
  min-height: 42px;
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--foreground);
  font-size: 14px;
  font-weight: 550;
  text-decoration: none;
}
.settings-frame__back:hover { background: var(--border); }
.settings-frame__top h1 { margin: 0 12px; color: var(--foreground); font-size: 20px; font-weight: 650; line-height: 1.4; }
.settings-frame__group-label { margin: 28px 12px 10px; color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }
.settings-frame__nav nav { display: grid; gap: 6px; }
.settings-frame__nav nav a {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 9px;
  color: var(--muted-foreground);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
}
.settings-frame__nav nav a svg { flex-shrink: 0; }
.settings-frame__nav nav a:hover { background: var(--border); color: var(--foreground); }
.settings-frame__nav nav a.is-active { background: var(--primary-soft); color: var(--primary); font-weight: 650; }
.settings-frame__back:focus-visible, .settings-frame__nav nav a:focus-visible, .settings-frame__mobile-selector select:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.settings-frame__account { display: flex; align-items: center; gap: 11px; min-width: 0; margin-top: auto; padding: 28px 12px 0; }
.settings-frame__account-icon { display: grid; flex: 0 0 36px; height: 36px; place-items: center; border-radius: 50%; background: var(--surface); color: var(--muted-foreground); }
.settings-frame__account > span:last-child { display: grid; min-width: 0; gap: 4px; }
.settings-frame__account strong { overflow: hidden; color: var(--foreground); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.settings-frame__account small { color: var(--muted-foreground); font-size: 11px; }
.settings-frame__content {
  box-sizing: border-box;
  width: calc(100% - 8px);
  min-width: 0;
  min-height: calc(100dvh - 16px);
  margin: 8px 8px 8px 0;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  padding: 64px clamp(28px, 5vw, 88px) 64px;
}
.settings-frame__content :deep(> *) { max-width: 1000px; margin-left: auto; margin-right: auto; }
.settings-frame__mobile-selector { display: none; }
.settings-frame__sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 1100px) {
  .settings-frame { grid-template-columns: 224px minmax(0, 1fr); }
  .settings-frame__content { padding: 42px 28px; }
}
@media (max-width: 700px) {
  .settings-frame { grid-template-columns: minmax(0, 1fr); }
  .settings-frame__nav { z-index: 30; height: auto; overflow: visible; padding: 10px 16px 14px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }
  .settings-frame__top { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
  .settings-frame__back { gap: 7px; padding: 7px 0; font-size: 14px; }
  .settings-frame__top h1 { margin: 0; font-size: 16px; }
  .settings-frame__desktop-navigation, .settings-frame__account { display: none; }
  .settings-frame__mobile-selector { display: block; min-width: 0; margin-top: 8px; }
  .settings-frame__mobile-selector select { width: 100%; min-width: 0; min-height: 42px; border-color: var(--border); border-radius: 8px; background: var(--surface); padding: 9px 12px; font-size: 14px; }
  .settings-frame__content { width: 100%; min-height: calc(100dvh - 117px); margin: 0; border: 0; border-radius: 0; padding: 28px 16px 40px; }
}
</style>
