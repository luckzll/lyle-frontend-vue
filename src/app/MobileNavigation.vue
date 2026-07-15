<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import type { User } from '@/api/types'
import AccountMenu from '@/components/layout/AccountMenu.vue'
import {
  getNavigationBadge,
  getNavigationBadgeLabel,
  getVisibleNavigationGroups,
  isNavigationItemActive,
  type NavigationItem
} from './navigation'
import { useRoute } from 'vue-router'

const props = defineProps<{
  open: boolean
  user: User | null
  reminderCount: number
  executionCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  logout: []
}>()

const route = useRoute()
const drawer = ref<HTMLElement | null>(null)
const visibleGroups = computed(() => getVisibleNavigationGroups(props.user?.role === 'ADMIN', props.user?.id))

let previouslyFocusedElement: HTMLElement | null = null
let previousBodyOverflow = ''

function close() {
  emit('update:open', false)
}

function logout() {
  close()
  emit('logout')
}

function isActive(item: NavigationItem) {
  return isNavigationItemActive(item, route)
}

function badgeFor(item: NavigationItem) {
  return getNavigationBadge(item, { reminders: props.reminderCount, execution: props.executionCount })
}

function focusableElements(): HTMLElement[] {
  if (!drawer.value) return []
  return Array.from(
    drawer.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('hidden'))
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key !== 'Tab') return
  const elements = focusableElements()
  if (elements.length === 0) {
    event.preventDefault()
    drawer.value?.focus()
    return
  }

  const first = elements[0]
  const last = elements[elements.length - 1]
  const activeElement = document.activeElement

  if (event.shiftKey && (activeElement === first || !drawer.value?.contains(activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (activeElement === last || !drawer.value?.contains(activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocusedElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      await nextTick()
      drawer.value?.focus()
      return
    }

    document.body.style.overflow = previousBodyOverflow
    await nextTick()
    previouslyFocusedElement?.focus()
    previouslyFocusedElement = null
  }
)

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
  previouslyFocusedElement?.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mobile-navigation">
      <div
        v-if="open"
        class="mobile-navigation__backdrop"
        aria-hidden="false"
        @click.self="close"
        @keydown="handleKeydown"
      >
        <aside
          ref="drawer"
          class="mobile-navigation"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-navigation-title"
          tabindex="-1"
        >
          <header class="mobile-navigation__header">
            <RouterLink class="mobile-navigation__brand" to="/dashboard" @click="close">
              <span class="mobile-navigation__brand-mark" aria-hidden="true">L</span>
              <span>
                <strong id="mobile-navigation-title">Lyle AI</strong>
                <small>个人工作台</small>
              </span>
            </RouterLink>
            <button class="mobile-navigation__close" type="button" aria-label="关闭主导航" @click="close">
              <X :size="20" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </header>

          <nav class="mobile-navigation__content" aria-label="移动端主导航">
            <section v-for="group in visibleGroups" :key="group.id" class="mobile-navigation__group">
              <h2>{{ group.label }}</h2>
              <ul>
                <li v-for="item in group.items" :key="item.id">
                  <RouterLink
                    class="mobile-navigation__link"
                    :class="{ 'mobile-navigation__link--active': isActive(item) }"
                    :to="item.to"
                    :aria-current="isActive(item) ? 'page' : undefined"
                    @click="close"
                  >
                    <component :is="item.icon" :size="19" :stroke-width="1.8" aria-hidden="true" />
                    <span>{{ item.label }}</span>
                    <span
                      v-if="badgeFor(item) > 0"
                      class="mobile-navigation__badge"
                      :aria-label="getNavigationBadgeLabel(item, badgeFor(item))"
                    >
                      <span aria-hidden="true">{{ badgeFor(item) > 99 ? '99+' : badgeFor(item) }}</span>
                    </span>
                  </RouterLink>
                </li>
              </ul>
            </section>
          </nav>

          <footer class="mobile-navigation__footer">
            <AccountMenu
              :user="user"
              variant="mobile"
              side="top"
              align="start"
              @logout="logout"
            />
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-navigation__backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  background: var(--backdrop);
  overscroll-behavior: contain;
}

.mobile-navigation {
  display: flex;
  width: min(21rem, calc(100vw - 2.5rem));
  height: 100dvh;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--sidebar-background);
  box-shadow: var(--shadow-dialog);
  color: var(--sidebar-foreground);
}

.mobile-navigation__header {
  display: flex;
  min-height: var(--lyle-header-height);
  align-items: center;
  justify-content: space-between;
  gap: var(--lyle-space-3);
  border-bottom: 1px solid var(--sidebar-border);
  padding: 0 var(--lyle-space-4);
}

.mobile-navigation__brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--lyle-space-3);
  color: var(--foreground);
}

.mobile-navigation__brand-mark {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 2.25rem;
  place-items: center;
  border-radius: var(--lyle-radius-lg);
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 800;
}

.mobile-navigation__brand > span:last-child {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
}

.mobile-navigation__brand strong {
  overflow: hidden;
  color: var(--foreground);
  font-size: 0.86rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-navigation__brand small {
  color: var(--muted-foreground);
  font-size: 0.7rem;
}

.mobile-navigation__close {
  display: grid;
  width: 2.35rem;
  height: 2.35rem;
  flex: 0 0 2.35rem;
  place-items: center;
  border-radius: var(--lyle-radius-md);
  background: transparent;
  color: var(--muted-foreground);
  padding: 0;
}

.mobile-navigation__close:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.mobile-navigation__content {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--lyle-space-3);
  overscroll-behavior: contain;
}

.mobile-navigation__group + .mobile-navigation__group {
  margin-top: var(--lyle-space-4);
}

.mobile-navigation__group h2 {
  margin: 0 0 var(--lyle-space-1);
  padding: 0 var(--lyle-space-2);
  color: var(--muted-foreground);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mobile-navigation__group ul {
  display: grid;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mobile-navigation__link {
  display: flex;
  min-height: 2.65rem;
  align-items: center;
  gap: var(--lyle-space-3);
  border-radius: var(--lyle-radius-md);
  padding: 0.6rem 0.7rem;
  color: var(--sidebar-foreground);
  font-size: 0.9rem;
  font-weight: 550;
}

.mobile-navigation__link:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.mobile-navigation__link--active {
  background: var(--sidebar-active-bg);
  color: var(--sidebar-active-fg);
  font-weight: 700;
}

.mobile-navigation__badge {
  min-width: 1.25rem;
  margin-left: auto;
  border-radius: var(--lyle-radius-full);
  background: var(--danger);
  color: var(--lyle-color-white);
  padding: 0.12rem 0.35rem;
  font-size: 0.66rem;
  font-weight: 800;
  text-align: center;
}

.mobile-navigation__footer {
  border-top: 1px solid var(--sidebar-border);
  padding: var(--lyle-space-3);
}

.mobile-navigation-enter-active,
.mobile-navigation-leave-active {
  transition: opacity var(--lyle-duration-normal) var(--lyle-ease-standard);
}

.mobile-navigation-enter-active .mobile-navigation,
.mobile-navigation-leave-active .mobile-navigation {
  transition: transform var(--lyle-duration-normal) var(--lyle-ease-standard);
}

.mobile-navigation-enter-from,
.mobile-navigation-leave-to {
  opacity: 0;
}

.mobile-navigation-enter-from .mobile-navigation,
.mobile-navigation-leave-to .mobile-navigation {
  transform: translateX(-1rem);
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
