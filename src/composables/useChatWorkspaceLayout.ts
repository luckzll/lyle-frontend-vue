import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { clampWorkspaceWidth, DEFAULT_WORKSPACE_FRACTION } from '@/domain/chat-workspace-layout'

export function useChatWorkspaceLayout() {
  const workspaceElement = ref<HTMLElement>()
  const width = ref<number>()
  const expanded = ref(false)
  const resizing = ref(false)
  const total = ref(0)
  let observer: ResizeObserver | undefined
  const effectiveWidth = computed(() => clampWorkspaceWidth(width.value ?? total.value * DEFAULT_WORKSPACE_FRACTION, total.value))
  const style = computed(() => ({ '--workspace-pane-width': total.value ? `${effectiveWidth.value}px` : '52%' }))
  const percentage = computed(() => total.value ? Math.round(effectiveWidth.value / total.value * 100) : 52)
  const minimumPercentage = computed(() => total.value ? Math.round(clampWorkspaceWidth(0, total.value) / total.value * 100) : 20)
  const maximumPercentage = computed(() => total.value ? Math.round(clampWorkspaceWidth(total.value, total.value) / total.value * 100) : 80)
  function measure() { total.value = workspaceElement.value?.clientWidth ?? 0 }
  function reset() { width.value = undefined }
  function start(event: PointerEvent) {
    if (event.button !== 0 || window.matchMedia('(max-width:1100px)').matches) return
    event.preventDefault(); measure(); resizing.value = true
    const separator = event.currentTarget as HTMLElement
    separator.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) {
    if (!resizing.value) return
    const rect = workspaceElement.value?.getBoundingClientRect()
    if (rect) width.value = clampWorkspaceWidth(rect.right - event.clientX, rect.width)
  }
  function finish(event: PointerEvent) {
    resizing.value = false
    const element = event.currentTarget as HTMLElement
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Home') { event.preventDefault(); reset(); return }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault(); measure()
    width.value = clampWorkspaceWidth(effectiveWidth.value + (event.key === 'ArrowLeft' ? 32 : -32), total.value)
  }
  onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined' && workspaceElement.value) { observer = new ResizeObserver(measure); observer.observe(workspaceElement.value) }
    else window.addEventListener('resize', measure)
  })
  onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('resize', measure) })
  return { workspaceElement, expanded, resizing, style, percentage, minimumPercentage, maximumPercentage, start, move, finish, keydown, reset }
}
