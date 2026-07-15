<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { X } from '@lucide/vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string }>(), { description: '' })
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
const descriptionId = useId()

watch(() => props.open, async (open) => {
  await nextTick()
  if (open && dialog.value && !dialog.value.open) dialog.value.showModal()
  if (!open && dialog.value?.open) dialog.value.close()
}, { immediate: true })

function close() { emit('update:open', false) }
function cancel(event: Event) { event.preventDefault(); close() }
</script>

<template>
  <dialog
    ref="dialog"
    class="detail-drawer"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
    @cancel="cancel"
    @close="close"
  >
    <header>
      <div><h2 :id="titleId">{{ title }}</h2><p v-if="description" :id="descriptionId">{{ description }}</p></div>
      <button type="button" aria-label="关闭详情" @click="close"><X :size="19" /></button>
    </header>
    <div class="drawer-content"><slot /></div>
    <footer v-if="$slots.footer"><slot name="footer" /></footer>
  </dialog>
</template>

<style scoped>
.detail-drawer { position: fixed; inset: 0 0 0 auto; width: min(92vw, 540px); max-width: none; height: 100dvh; max-height: none; margin: 0; border: 0; border-left: 1px solid var(--border); background: var(--surface); padding: 0; color: var(--foreground); box-shadow: var(--shadow-dialog); }
.detail-drawer::backdrop { background: var(--backdrop); }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); border-bottom: 1px solid var(--border); padding: var(--space-5); }
h2 { margin: 0; font-size: 20px; } p { margin: 6px 0 0; color: var(--muted-foreground); }
header button { display: grid; width: 36px; height: 36px; place-items: center; border-radius: var(--radius-md); background: transparent; color: var(--muted-foreground); padding: 0; }
header button:hover { background: var(--surface-muted); }
.drawer-content { height: calc(100dvh - 82px); overflow: auto; padding: var(--space-5); }
footer { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: var(--space-2); border-top: 1px solid var(--border); background: var(--surface); padding: var(--space-4) var(--space-5); }
</style>
