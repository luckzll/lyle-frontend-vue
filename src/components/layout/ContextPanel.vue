<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'

const props = withDefaults(defineProps<{
  title?: string
  open?: boolean
  variant?: 'default' | 'memory'
}>(), { title: '上下文', open: true, variant: 'default' })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const isOverlay = ref(false)
let mediaQuery: MediaQueryList | null = null
let restoreFocus: HTMLElement | null = null
let previousBodyOverflow = ''
let overlayActive = false

function updateOverlay(event?: MediaQueryListEvent) {
  isOverlay.value = event?.matches ?? mediaQuery?.matches ?? false
}

function focusableElements(): HTMLElement[] {
  if (!panel.value) return []
  return Array.from(panel.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
}

function focusFirstElement() {
  const first = focusableElements()[0]
  if (first) first.focus()
  else panel.value?.focus()
}

async function activateOverlay() {
  if (!props.open || !isOverlay.value) return
  if (!overlayActive) {
    overlayActive = true
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('focusin', keepFocusInside)
  }
  await nextTick()
  if (props.open && isOverlay.value && overlayActive) panel.value?.focus()
}

function deactivateOverlay() {
  if (!overlayActive) return
  overlayActive = false
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('focusin', keepFocusInside)
  document.body.style.overflow = previousBodyOverflow
  const target = restoreFocus
  restoreFocus = null
  if (target?.isConnected) void nextTick(() => target.focus())
}

function keepFocusInside(event: FocusEvent) {
  if (!overlayActive || !panel.value) return
  if (event.target instanceof Node && panel.value.contains(event.target)) return
  focusFirstElement()
}

function handleKeydown(event: KeyboardEvent) {
  if (!overlayActive || !isOverlay.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = focusableElements()
  if (!focusable.length) {
    event.preventDefault()
    panel.value.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const activeElement = document.activeElement
  const focusOutside = !panel.value.contains(activeElement)
  if (event.shiftKey && (activeElement === first || activeElement === panel.value || focusOutside)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && (activeElement === last || focusOutside)) {
    event.preventDefault()
    first?.focus()
  }
}

watch([() => props.open, isOverlay], ([open, overlay]) => {
  if (open && overlay) void activateOverlay()
  else deactivateOverlay()
})

onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 1024px)')
  updateOverlay()
  mediaQuery.addEventListener('change', updateOverlay)
  if (props.open && isOverlay.value) void activateOverlay()
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', updateOverlay)
  deactivateOverlay()
})
</script>

<template>
  <Teleport to="body" :disabled="!isOverlay">
    <div
      v-if="open"
      class="context-panel-layer"
      :class="[
        { 'context-panel-layer--overlay': isOverlay },
        `context-panel-layer--${variant}`
      ]"
      :data-testid="isOverlay ? 'context-panel-backdrop' : undefined"
      @click.self="$emit('close')"
    >
      <aside
        ref="panel"
        class="context-panel"
        :class="`context-panel--${variant}`"
        :aria-label="title"
        :aria-modal="isOverlay ? 'true' : undefined"
        :role="isOverlay ? 'dialog' : undefined"
        :tabindex="isOverlay ? -1 : undefined"
      >
        <header><strong>{{ title }}</strong><button type="button" aria-label="关闭上下文栏" @click="$emit('close')"><X :size="17" /></button></header>
        <div class="content"><slot /></div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.context-panel-layer { display: contents; }
.context-panel-layer--overlay {
  position: fixed;
  z-index: 90;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  background: var(--backdrop);
  overscroll-behavior: contain;
  padding: 72px var(--space-3) calc(76px + env(safe-area-inset-bottom));
}
.context-panel { min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); overflow: hidden; }
.context-panel-layer--overlay .context-panel { width: min(90vw, 360px); min-height: 0; overflow: auto; box-shadow: var(--shadow-dialog); }
header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding: var(--space-3) var(--space-4); }
header button { display: grid; width: 30px; height: 30px; place-items: center; border-radius: var(--radius-md); background: transparent; color: var(--muted-foreground); padding: 0; }
header button:hover { background: var(--surface-muted); }
.content { display: grid; gap: var(--space-4); padding: var(--space-4); }

@media (max-width: 640px) {
  .context-panel-layer--overlay.context-panel-layer--memory {
    align-items: flex-end;
    justify-content: stretch;
    padding: 0;
  }
  .context-panel-layer--memory .context-panel--memory {
    width: 100%;
    max-height: min(62dvh, 560px);
    border-width: 1px 0 0;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .context-panel-layer--memory .context-panel--memory::before {
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: var(--border-strong);
    content: '';
    margin: 8px auto 0;
  }
}
</style>
