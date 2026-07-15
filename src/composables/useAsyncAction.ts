import { computed, reactive } from 'vue'

export function useAsyncAction() {
  const pending = reactive(new Set<string>())

  const anyPending = computed(() => pending.size > 0)
  const isPending = (key: string | number) => pending.has(String(key))

  async function run<T>(key: string | number, action: () => Promise<T>): Promise<T | undefined> {
    const normalized = String(key)
    if (pending.has(normalized)) return undefined
    pending.add(normalized)
    try {
      return await action()
    } finally {
      pending.delete(normalized)
    }
  }

  return { anyPending, isPending, run }
}
