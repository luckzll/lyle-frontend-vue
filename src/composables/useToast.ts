import { readonly, ref } from 'vue'

export type ToastTone = 'success' | 'danger' | 'info'
export type ToastItem = { id: number; title: string; message?: string; tone: ToastTone }

const items = ref<ToastItem[]>([])
let sequence = 0

export function useToast() {
  function show(title: string, options: { message?: string; tone?: ToastTone; duration?: number } = {}) {
    const id = ++sequence
    items.value.push({ id, title, message: options.message, tone: options.tone || 'success' })
    window.setTimeout(() => dismiss(id), options.duration ?? 4_000)
    return id
  }

  function dismiss(id: number) {
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items: readonly(items), show, dismiss }
}
