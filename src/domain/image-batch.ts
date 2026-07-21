import type { ImageBatchItem } from '@/api/app'

export function cancelPendingImageItems(items: ImageBatchItem[]): ImageBatchItem[] {
  return items.map((item) => {
    if (item.status !== 'QUEUED' && item.status !== 'RUNNING') return item
    return { ...item, status: 'CANCELLED' }
  })
}
