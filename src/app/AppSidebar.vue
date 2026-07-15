<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDown } from '@lucide/vue'
import type { User } from '@/api/types'
import AccountMenu from '@/components/layout/AccountMenu.vue'
import {
  getNavigationBadge,
  getNavigationBadgeLabel,
  getVisibleNavigationGroups,
  isNavigationItemActive,
  type NavigationGroup,
  type NavigationGroupId,
  type NavigationItem
} from './navigation'

const props = defineProps<{
  collapsed: boolean
  user: User | null
  reminderCount: number
  executionCount: number
}>()

const emit = defineEmits<{
  logout: []
}>()

const route = useRoute()
const visibleGroups = computed(() => getVisibleNavigationGroups(props.user?.role === 'ADMIN', props.user?.id))
const expandedOptionalGroups = ref<Set<NavigationGroupId>>(new Set())

function isActive(item: NavigationItem) {
  return isNavigationItemActive(item, route)
}

function badgeFor(item: NavigationItem) {
  return getNavigationBadge(item, { reminders: props.reminderCount, execution: props.executionCount })
}

function isPrimaryGroup(groupId: NavigationGroupId) {
  return groupId === 'start' || groupId === 'progress'
}

function isGroupActive(group: NavigationGroup) {
  return group.items.some((item) => isActive(item))
}

function isGroupExpanded(group: NavigationGroup) {
  return props.collapsed
    || isPrimaryGroup(group.id)
    || isGroupActive(group)
    || expandedOptionalGroups.value.has(group.id)
}

function toggleGroup(groupId: NavigationGroupId) {
  const next = new Set(expandedOptionalGroups.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  expandedOptionalGroups.value = next
}
</script>

<template>
  <aside
    class="app-sidebar"
    :class="{ 'app-sidebar--collapsed': collapsed }"
    :aria-label="collapsed ? '主导航（已折叠）' : '主导航'"
  >
    <RouterLink class="app-sidebar__brand" to="/dashboard" aria-label="Lyle AI 工作台">
      <span class="app-sidebar__brand-mark" aria-hidden="true">L</span>
      <span v-if="!collapsed" class="app-sidebar__brand-copy">
        <strong>Lyle AI</strong>
        <small>个人工作台</small>
      </span>
    </RouterLink>

    <nav class="app-sidebar__navigation">
      <section
        v-for="group in visibleGroups"
        :key="group.id"
        class="app-sidebar__group"
        :aria-labelledby="`desktop-navigation-${group.id}`"
      >
        <button
          v-if="!collapsed && !isPrimaryGroup(group.id)"
          :id="`desktop-navigation-${group.id}`"
          class="app-sidebar__group-toggle"
          type="button"
          :aria-expanded="isGroupExpanded(group)"
          :aria-label="`${isGroupExpanded(group) ? '收起' : '展开'}${group.label}`"
          @click="toggleGroup(group.id)"
        >
          <span>{{ group.label }}</span>
          <ChevronDown :size="15" :class="{ expanded: isGroupExpanded(group) }" aria-hidden="true" />
        </button>
        <p
          v-else
          :id="`desktop-navigation-${group.id}`"
          class="app-sidebar__group-label"
          :class="{ 'sr-only': collapsed }"
        >{{ group.label }}</p>
        <ul v-if="isGroupExpanded(group)" class="app-sidebar__list">
          <li v-for="item in group.items" :key="item.id">
            <RouterLink
              class="app-sidebar__link"
              :class="{ 'app-sidebar__link--active': isActive(item) }"
              :to="item.to"
              :title="collapsed ? `${item.label} · ${item.description}` : undefined"
              :aria-label="collapsed ? item.label : undefined"
              :aria-current="isActive(item) ? 'page' : undefined"
            >
              <component :is="item.icon" class="app-sidebar__icon" :size="19" :stroke-width="1.8" aria-hidden="true" />
              <span v-if="!collapsed" class="app-sidebar__label">{{ item.label }}</span>
              <span
                v-if="badgeFor(item) > 0"
                class="app-sidebar__badge"
                :class="{ 'app-sidebar__badge--compact': collapsed }"
                :aria-label="getNavigationBadgeLabel(item, badgeFor(item))"
              >
                {{ badgeFor(item) > 99 ? '99+' : badgeFor(item) }}
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </nav>

    <div class="app-sidebar__footer">
      <AccountMenu
        :user="user"
        variant="sidebar"
        :side="collapsed ? 'right' : 'top'"
        align="start"
        :compact="collapsed"
        @logout="emit('logout')"
      />
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  flex-direction: column;
  overflow: visible;
  border-right: 1px solid var(--sidebar-border);
  background: var(--sidebar-background);
  color: var(--sidebar-foreground);
}

.app-sidebar__brand {
  display: flex;
  min-height: var(--lyle-header-height);
  align-items: center;
  gap: var(--lyle-space-3);
  border-bottom: 1px solid var(--sidebar-border);
  padding: 0 var(--lyle-space-4);
  color: var(--foreground);
}

.app-sidebar__brand-mark {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 2.25rem;
  place-items: center;
  border-radius: var(--lyle-radius-lg);
  background: var(--primary);
  color: var(--primary-foreground);
  box-shadow: var(--lyle-shadow-sm);
  font-size: 1rem;
  font-weight: 800;
}

.app-sidebar__brand-copy {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
}

.app-sidebar__brand-copy strong {
  overflow: hidden;
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__brand-copy small {
  color: var(--muted-foreground);
  font-size: 0.72rem;
}

.app-sidebar__navigation {
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--lyle-space-3);
  scrollbar-width: thin;
}

.app-sidebar__group + .app-sidebar__group {
  margin-top: var(--lyle-space-4);
}

.app-sidebar--collapsed .app-sidebar__group + .app-sidebar__group {
  margin-top: var(--lyle-space-2);
  border-top: 1px solid var(--sidebar-border);
  padding-top: var(--lyle-space-2);
}

.app-sidebar__group-label {
  margin: 0 0 var(--lyle-space-1);
  padding: 0 var(--lyle-space-2);
  color: var(--muted-foreground);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-sidebar__group-toggle {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  padding: 0 var(--lyle-space-2);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-sidebar__group-toggle:hover { background: var(--surface-muted); color: var(--foreground); }
.app-sidebar__group-toggle svg { transition: transform var(--lyle-duration-fast) var(--lyle-ease-standard); }
.app-sidebar__group-toggle svg.expanded { transform: rotate(180deg); }

.app-sidebar__list {
  display: grid;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.app-sidebar__link {
  position: relative;
  display: flex;
  min-height: 2.5rem;
  align-items: center;
  gap: var(--lyle-space-3);
  border-radius: var(--lyle-radius-md);
  padding: 0.55rem 0.65rem;
  color: var(--sidebar-foreground);
  font-size: 0.875rem;
  font-weight: 550;
  transition:
    background-color var(--lyle-duration-fast) var(--lyle-ease-standard),
    color var(--lyle-duration-fast) var(--lyle-ease-standard);
}

.app-sidebar__link:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.app-sidebar__link--active {
  background: var(--sidebar-active-bg);
  color: var(--sidebar-active-fg);
  font-weight: 700;
}

.app-sidebar__icon {
  flex: 0 0 auto;
}

.app-sidebar__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-sidebar__badge {
  min-width: 1.25rem;
  margin-left: auto;
  border-radius: var(--lyle-radius-full);
  background: var(--danger);
  color: var(--lyle-color-white);
  padding: 0.12rem 0.35rem;
  font-size: 0.66rem;
  font-weight: 800;
  line-height: 1rem;
  text-align: center;
}

.app-sidebar__badge--compact {
  position: absolute;
  top: 0.2rem;
  right: 0.15rem;
  display: block;
  min-width: 0.95rem;
  padding: 0 0.2rem;
  font-size: 0.58rem;
  line-height: 0.95rem;
}

.app-sidebar__footer {
  position: relative;
  border-top: 1px solid var(--sidebar-border);
  padding: var(--lyle-space-3);
}

.app-sidebar--collapsed .app-sidebar__brand,
.app-sidebar--collapsed .app-sidebar__link {
  justify-content: center;
}

.app-sidebar--collapsed .app-sidebar__navigation,
.app-sidebar--collapsed .app-sidebar__footer {
  padding-right: var(--lyle-space-2);
  padding-left: var(--lyle-space-2);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
