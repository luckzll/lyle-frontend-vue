<script setup lang="ts">
import { Bell, Menu, PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import type { User } from '@/api/types'

const props = defineProps<{
  title: string
  collapsed: boolean
  user: User | null
  reminderCount: number
}>()

const emit = defineEmits<{
  toggleSidebar: []
  openMobileNavigation: []
}>()
</script>

<template>
  <header class="app-header">
    <div class="app-header__leading">
      <button
        class="app-header__icon-button app-header__desktop-toggle"
        type="button"
        :aria-label="collapsed ? '展开侧栏' : '折叠侧栏'"
        :title="collapsed ? '展开侧栏' : '折叠侧栏'"
        @click="emit('toggleSidebar')"
      >
        <PanelLeftOpen v-if="collapsed" :size="20" :stroke-width="1.8" aria-hidden="true" />
        <PanelLeftClose v-else :size="20" :stroke-width="1.8" aria-hidden="true" />
      </button>
      <button
        class="app-header__icon-button app-header__mobile-toggle"
        type="button"
        aria-label="打开主导航"
        aria-haspopup="dialog"
        @click="emit('openMobileNavigation')"
      >
        <Menu :size="21" :stroke-width="1.8" aria-hidden="true" />
      </button>
      <div class="app-header__title-block">
        <span>个人 AI 工作台</span>
        <p class="app-header__page-title">{{ title }}</p>
      </div>
    </div>

    <div class="app-header__actions">
      <RouterLink
        class="app-header__notification"
        to="/tasks"
        :aria-label="reminderCount > 0 ? `${reminderCount} 条未读提醒` : '暂无未读提醒'"
        title="提醒"
      >
        <Bell :size="19" :stroke-width="1.8" aria-hidden="true" />
        <span v-if="reminderCount > 0" class="app-header__notification-badge" aria-hidden="true">
          {{ reminderCount > 99 ? '99+' : reminderCount }}
        </span>
      </RouterLink>

    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  min-height: var(--lyle-header-height);
  align-items: center;
  justify-content: space-between;
  gap: var(--lyle-space-4);
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  padding: 0 var(--lyle-space-6);
  backdrop-filter: blur(12px);
}

.app-header__leading,
.app-header__actions {
  display: flex;
  min-width: 0;
  align-items: center;
}

.app-header__leading {
  gap: var(--lyle-space-3);
}

.app-header__actions {
  gap: var(--lyle-space-3);
}

.app-header__icon-button,
.app-header__notification {
  position: relative;
  display: inline-grid;
  width: 2.35rem;
  height: 2.35rem;
  flex: 0 0 2.35rem;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--lyle-radius-md);
  background: transparent;
  color: var(--muted-foreground);
  padding: 0;
  transition:
    background-color var(--lyle-duration-fast) var(--lyle-ease-standard),
    color var(--lyle-duration-fast) var(--lyle-ease-standard);
}

.app-header__icon-button:hover,
.app-header__notification:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.app-header__mobile-toggle {
  display: none;
}

.app-header__title-block {
  display: grid;
  min-width: 0;
  gap: 0.05rem;
}

.app-header__title-block span {
  color: var(--muted-foreground);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.app-header__page-title {
  margin: 0;
  overflow: hidden;
  color: var(--foreground);
  font-size: 1rem;
  font-weight: 750;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-header__notification-badge {
  position: absolute;
  top: -0.2rem;
  right: -0.25rem;
  min-width: 1.1rem;
  border: 2px solid var(--surface);
  border-radius: var(--lyle-radius-full);
  background: var(--danger);
  color: var(--lyle-color-white);
  padding: 0 0.2rem;
  font-size: 0.58rem;
  font-weight: 800;
  line-height: 0.9rem;
  text-align: center;
}

@media (max-width: 959px) {
  .app-header {
    padding: 0 var(--lyle-space-4);
  }

  .app-header__desktop-toggle {
    display: none;
  }

  .app-header__mobile-toggle {
    display: inline-grid;
  }
}

@media (max-width: 639px) {
  .app-header {
    gap: var(--lyle-space-2);
    padding: 0 var(--lyle-space-3);
  }

  .app-header__title-block span {
    display: none;
  }
}
</style>
