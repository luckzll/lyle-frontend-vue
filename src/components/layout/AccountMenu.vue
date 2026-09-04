<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { LogIn, LogOut, Settings } from '@lucide/vue'
import { useRoute } from 'vue-router'
import type { User } from '@/api/types'

const props = withDefaults(defineProps<{
  user: User | null
  variant?: 'header' | 'sidebar' | 'mobile'
  side?: 'top' | 'bottom' | 'right'
  align?: 'start' | 'end'
  compact?: boolean
}>(), {
  variant: 'sidebar',
  side: 'top',
  align: 'start',
  compact: false
})

const emit = defineEmits<{
  logout: []
}>()

const route = useRoute()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const menuId = `account-menu-${useId()}`
const username = computed(() => props.user?.username || '未登录')
const accountType = computed(() => props.user?.role === 'ADMIN' ? '管理员' : '个人账号')
const userInitial = computed(() => username.value.trim().charAt(0).toUpperCase() || 'L')
const loginTarget = computed(() => route.path === '/login' ? '/dashboard' : route.fullPath)

function menuItems(): HTMLElement[] {
  if (!menu.value) return []
  return Array.from(menu.value.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

async function openMenu(focus: 'none' | 'first' | 'last' = 'none') {
  open.value = true
  await nextTick()
  if (focus === 'first') menuItems()[0]?.focus()
  if (focus === 'last') {
    const items = menuItems()
    items[items.length - 1]?.focus()
  }
}

function closeMenu(restoreFocus = false) {
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function toggleMenu() {
  if (open.value) closeMenu()
  else void openMenu()
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!open.value || root.value?.contains(event.target as Node)) return
  closeMenu()
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (!open.value || event.key !== 'Escape') return
  event.preventDefault()
  closeMenu(true)
}

function handleMenuKeydown(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = menuItems()
  if (!items.length) return
  const currentIndex = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Home') return items[0].focus()
  if (event.key === 'End') return items[items.length - 1]?.focus()
  const direction = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex = currentIndex < 0
    ? (direction > 0 ? 0 : items.length - 1)
    : (currentIndex + direction + items.length) % items.length
  items[nextIndex].focus()
}

function logout() {
  closeMenu()
  emit('logout')
}

watch(() => route.fullPath, () => closeMenu())

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div
    ref="root"
    class="account-menu"
    :class="[
      `account-menu--${variant}`,
      `account-menu--side-${side}`,
      `account-menu--align-${align}`,
      { 'account-menu--compact': compact }
    ]"
  >
    <RouterLink
      v-if="!user"
      class="account-menu__guest-login"
      :to="{ name: 'login', query: { redirect: loginTarget } }"
      aria-label="登录或注册，解锁完整工作台"
    >
      <span class="account-menu__guest-icon" aria-hidden="true"><LogIn :size="17" :stroke-width="1.9" /></span>
      <span v-if="!compact" class="account-menu__guest-copy">
        <strong>登录 / 注册</strong>
        <small>解锁完整工作台</small>
      </span>
    </RouterLink>
    <button
      v-else
      ref="trigger"
      class="account-menu__trigger"
      type="button"
      :aria-label="`${open ? '关闭' : '打开'} ${username} 账号菜单`"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :title="compact ? username : undefined"
      @click="toggleMenu"
      @keydown.arrow-down.prevent="openMenu('first')"
      @keydown.arrow-up.prevent="openMenu('last')"
    >
      <span class="account-menu__avatar" aria-hidden="true">{{ userInitial }}</span>
      <span v-if="!compact" class="account-menu__trigger-copy">
        <strong>{{ username }}</strong>
        <small>{{ accountType }}</small>
      </span>
    </button>

    <Transition name="account-menu-popover">
      <div
        v-if="open && user"
        :id="menuId"
        ref="menu"
        class="account-menu__popover"
        role="menu"
        aria-label="账号菜单"
        @keydown="handleMenuKeydown"
      >
        <div class="account-menu__identity">
          <span class="account-menu__avatar" aria-hidden="true">{{ userInitial }}</span>
          <span>
            <strong>{{ username }}</strong>
            <small>{{ accountType }}</small>
          </span>
        </div>

        <div class="account-menu__separator" role="separator" />

        <RouterLink class="account-menu__item" :to="{ name: 'settings' }" role="menuitem" @click="closeMenu()">
          <Settings :size="18" :stroke-width="1.8" aria-hidden="true" />
          <span>设置</span>
        </RouterLink>
        <button class="account-menu__item" type="button" role="menuitem" @click="logout">
          <LogOut :size="18" :stroke-width="1.8" aria-hidden="true" />
          <span>退出登录</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.account-menu {
  position: relative;
  min-width: 0;
}

.account-menu--sidebar,
.account-menu--mobile {
  width: 100%;
}

.account-menu__trigger {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  align-items: center;
  justify-content: flex-start;
  gap: var(--lyle-space-3);
  border: 1px solid transparent;
  border-radius: var(--lyle-radius-lg);
  background: transparent;
  color: var(--foreground);
  padding: 0.4rem;
  text-align: left;
  transition:
    background-color var(--lyle-duration-fast) var(--lyle-ease-standard),
    border-color var(--lyle-duration-fast) var(--lyle-ease-standard);
}

.account-menu__guest-login {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  align-items: center;
  justify-content: flex-start;
  gap: var(--lyle-space-3);
  border: 1px solid var(--primary-border);
  border-radius: var(--lyle-radius-lg);
  background: var(--primary-soft);
  color: var(--foreground);
  padding: 0.4rem;
  transition: border-color var(--lyle-duration-fast) var(--lyle-ease-standard), background-color var(--lyle-duration-fast) var(--lyle-ease-standard);
}

.account-menu__guest-login:hover { border-color: var(--primary); background: color-mix(in srgb, var(--primary-soft) 74%, var(--surface)); }
.account-menu__guest-login:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.account-menu__guest-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  place-items: center;
  border-radius: var(--lyle-radius-full);
  background: var(--primary);
  color: var(--primary-foreground);
}
.account-menu__guest-copy { display: grid; min-width: 0; gap: 0.08rem; }
.account-menu__guest-copy strong { color: var(--foreground); font-size: 0.78rem; }
.account-menu__guest-copy small { color: var(--muted-foreground); font-size: 0.68rem; }

.account-menu--header .account-menu__guest-login {
  width: auto;
  min-height: 2.5rem;
  gap: var(--lyle-space-2);
  padding: 0.25rem 0.65rem 0.25rem 0.3rem;
}

.account-menu--compact .account-menu__guest-login { justify-content: center; }

.account-menu__trigger:hover,
.account-menu__trigger[aria-expanded='true'] {
  border-color: var(--border);
  background: var(--surface-muted);
}

.account-menu__trigger:focus-visible,
.account-menu__item:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.account-menu--header .account-menu__trigger {
  width: auto;
  min-height: 2.5rem;
  gap: var(--lyle-space-2);
  padding: 0.25rem 0.4rem;
}

.account-menu--compact .account-menu__trigger {
  justify-content: center;
}

.account-menu__avatar {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  place-items: center;
  border-radius: var(--lyle-radius-full);
  background: var(--accent);
  color: var(--accent-foreground);
  font-size: 0.75rem;
  font-weight: 800;
}

.account-menu__trigger-copy,
.account-menu__identity > span:last-child {
  display: grid;
  min-width: 0;
  gap: 0.08rem;
}

.account-menu__trigger-copy strong,
.account-menu__identity strong {
  max-width: 9.5rem;
  overflow: hidden;
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu__trigger-copy small,
.account-menu__identity small {
  color: var(--muted-foreground);
  font-size: 0.68rem;
}

.account-menu__popover {
  position: absolute;
  z-index: 200;
  width: min(15.5rem, calc(100vw - 1.5rem));
  border: 1px solid var(--border);
  border-radius: var(--lyle-radius-xl);
  background: var(--surface);
  padding: 0.4rem;
  box-shadow: var(--shadow-popover);
  color: var(--foreground);
}

.account-menu--side-top .account-menu__popover {
  bottom: calc(100% + 0.5rem);
}

.account-menu--side-bottom .account-menu__popover {
  top: calc(100% + 0.5rem);
}

.account-menu--side-right .account-menu__popover {
  bottom: 0;
  left: calc(100% + 0.5rem);
}

.account-menu--align-start:not(.account-menu--side-right) .account-menu__popover {
  left: 0;
}

.account-menu--align-end:not(.account-menu--side-right) .account-menu__popover {
  right: 0;
}

.account-menu__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--lyle-space-3);
  padding: 0.55rem 0.6rem;
}

.account-menu__separator {
  height: 1px;
  margin: 0.3rem 0;
  background: var(--border);
}

.account-menu__item {
  display: flex;
  width: 100%;
  min-height: 2.45rem;
  align-items: center;
  justify-content: flex-start;
  gap: var(--lyle-space-3);
  border: 0;
  border-radius: var(--lyle-radius-md);
  background: transparent;
  color: var(--foreground);
  padding: 0.55rem 0.65rem;
  font-size: 0.84rem;
  font-weight: 600;
  text-decoration: none;
}

.account-menu__item:hover {
  background: var(--surface-muted);
}

.account-menu-popover-enter-active,
.account-menu-popover-leave-active {
  transition:
    opacity var(--lyle-duration-fast) var(--lyle-ease-standard),
    transform var(--lyle-duration-fast) var(--lyle-ease-standard);
}

.account-menu-popover-enter-from,
.account-menu-popover-leave-to {
  opacity: 0;
  transform: translateY(0.25rem) scale(0.98);
}

@media (max-width: 480px) {
  .account-menu--header .account-menu__trigger-copy {
    display: none;
  }

  .account-menu--header .account-menu__trigger {
    justify-content: center;
    padding-inline: 0.25rem;
  }

  .account-menu--header .account-menu__guest-copy { display: none; }
  .account-menu--header .account-menu__guest-login { padding: 0.25rem; }
}
</style>
