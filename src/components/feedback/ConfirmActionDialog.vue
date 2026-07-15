<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { TriangleAlert, X } from '@lucide/vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
}>(), {
  confirmLabel: '确认',
  cancelLabel: '取消',
  danger: false,
  busy: false
})

const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const descriptionId = useId()

watch(() => props.open, async (open) => {
  await nextTick()
  if (open && dialog.value && !dialog.value.open) dialog.value.showModal()
  if (!open && dialog.value?.open) dialog.value.close()
}, { immediate: true })

function close() {
  if (props.busy) return
  emit('update:open', false)
}

function onCancel(event: Event) {
  event.preventDefault()
  close()
}
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    @cancel="onCancel"
    @close="emit('update:open', false)"
  >
    <form method="dialog" class="dialog-card" @submit.prevent>
      <header>
        <span class="warning-icon" :class="{ danger }"><TriangleAlert :size="19" aria-hidden="true" /></span>
        <div>
          <h2 :id="titleId">{{ title }}</h2>
          <p :id="descriptionId">{{ description }}</p>
        </div>
        <button class="icon-close" type="button" aria-label="关闭对话框" :disabled="busy" @click="close"><X :size="18" /></button>
      </header>
      <div v-if="$slots.default" class="details"><slot /></div>
      <footer>
        <AppButton variant="secondary" :disabled="busy" @click="close">{{ cancelLabel }}</AppButton>
        <AppButton :variant="danger ? 'danger' : 'primary'" :loading="busy" @click="emit('confirm')">{{ confirmLabel }}</AppButton>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.confirm-dialog { position: fixed; inset: 0; width: min(92vw, 480px); max-width: none; max-height: 90dvh; margin: auto; overflow: auto; border: 0; border-radius: var(--radius-xl); background: transparent; padding: 0; color: var(--foreground); box-shadow: var(--shadow-dialog); }
.confirm-dialog::backdrop { background: var(--backdrop); backdrop-filter: blur(2px); }
.dialog-card { display: grid; gap: var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: var(--space-5); }
header { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: var(--space-3); }
.warning-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: var(--radius-md); background: var(--warning-soft); color: var(--warning-strong); }
.warning-icon.danger { background: var(--danger-soft); color: var(--danger-strong); }
h2 { margin: 1px 0 6px; font-size: 18px; } p { margin: 0; color: var(--muted-foreground); line-height: 1.55; }
.icon-close { display: grid; width: 32px; height: 32px; place-items: center; border-radius: var(--radius-md); background: transparent; color: var(--muted-foreground); padding: 0; }
.icon-close:hover { background: var(--surface-muted); }
.details { border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-3); }
footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
@media (max-width: 480px) { footer { flex-direction: column-reverse; } footer :deep(button) { width: 100%; } }
</style>
