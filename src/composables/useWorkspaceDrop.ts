import { onBeforeUnmount, onMounted, ref } from 'vue'

type OverlayAction = 'show' | 'hide' | 'drop' | 'cancel'

export function useWorkspaceDrop(
  onDrop: (dataTransfer: DataTransfer, signal: AbortSignal) => Promise<void> | void,
  onOverlayAction?: (action: OverlayAction) => void
) {
  const dragDepth = ref(0)
  const dragging = ref(false)
  const scanning = ref(false)
  let scanController: AbortController | undefined

  function dragenter(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    dragDepth.value += 1
    if (!dragging.value) onOverlayAction?.('show')
    dragging.value = true
  }
  function dragleave(event: DragEvent) {
    event.preventDefault()
    dragDepth.value = Math.max(0, dragDepth.value - 1)
    if (!dragDepth.value && dragging.value) {
      dragging.value = false
      onOverlayAction?.('hide')
    }
  }
  function dragover(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }
  async function drop(event: DragEvent) {
    if (!event.dataTransfer) return
    event.preventDefault()
    reset('drop')
    scanController = new AbortController()
    scanning.value = true
    try { await onDrop(event.dataTransfer, scanController.signal) } finally {
      scanning.value = false
      scanController = undefined
    }
  }
  function reset(action: Exclude<OverlayAction, 'show'> = 'cancel', notify = true) {
    const wasActive = dragging.value || scanning.value
    dragDepth.value = 0
    dragging.value = false
    scanController?.abort()
    if (wasActive && notify) onOverlayAction?.(action)
  }
  function escape(event: KeyboardEvent) { if (event.key === 'Escape') reset() }
  function cancel() { reset() }

  onMounted(() => {
    window.addEventListener('blur', cancel)
    document.addEventListener('keydown', escape)
    document.addEventListener('dragend', cancel)
  })
  onBeforeUnmount(() => {
    reset('cancel', false)
    window.removeEventListener('blur', cancel)
    document.removeEventListener('keydown', escape)
    document.removeEventListener('dragend', cancel)
  })
  return { dragging, scanning, dragenter, dragleave, dragover, drop, reset }
}
