import { describe, expect, it } from 'vitest'

import type { ImageBatchItem } from '@/api/app'
import { cancelPendingImageItems } from '@/domain/image-batch'

describe('image batch cancellation', () => {
  it('marks only queued and running cards as cancelled', () => {
    const items: ImageBatchItem[] = [
      { index: 0, status: 'COMPLETED', imageUrl: 'https://example.com/done.png' },
      { index: 1, status: 'RUNNING' },
      { index: 2, status: 'QUEUED' },
      { index: 3, status: 'FAILED', error: 'provider error' }
    ]

    expect(cancelPendingImageItems(items)).toEqual([
      items[0],
      { index: 1, status: 'CANCELLED' },
      { index: 2, status: 'CANCELLED' },
      items[3]
    ])
  })
})
