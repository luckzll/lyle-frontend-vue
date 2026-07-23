import { describe, expect, it } from 'vitest'
import { normalizeRelativePath, scanDataTransfer, scanPickerFiles } from '@/composables/useDirectoryEntries'

type FakeEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (success: (file: File) => void) => void
  createReader?: () => { readEntries: (success: (entries: FakeEntry[]) => void) => void }
}

function fileEntry(name: string, text = name): FakeEntry {
  return { isFile: true, isDirectory: false, name, file: (success) => success(new File([text], name, { type: 'text/plain' })) }
}

function directoryEntry(name: string, batches: FakeEntry[][]): FakeEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let index = 0
      return { readEntries: (success) => success(batches[index++] || []) }
    }
  }
}

describe('directory entry scanning', () => {
  it('reads every directory batch, skips hidden files, and naturally sorts paths', async () => {
    const root = directoryEntry('资料', [
      [fileEntry('10.txt'), fileEntry('.secret')],
      [fileEntry('2.txt')],
      []
    ])
    const dataTransfer = {
      items: [{ kind: 'file', getAsEntry: () => root, getAsFile: () => null }],
      files: []
    } as unknown as DataTransfer

    const result = await scanDataTransfer(dataTransfer)

    expect(result.files.map((item) => item.relativePath)).toEqual(['资料/2.txt', '资料/10.txt'])
    expect(result.files.every((item) => item.sourceType === 'folder_drop')).toBe(true)
    expect(result.files[0]?.folderGroupId).toBe(result.files[1]?.folderGroupId)
    expect(result.skipped).toEqual([expect.objectContaining({ name: '.secret', reason: 'hidden' })])
  })

  it('groups picker files and keeps stable natural order', () => {
    const ten = new File(['10'], '10.txt', { type: 'text/plain' })
    const two = new File(['2'], '2.txt', { type: 'text/plain' })
    Object.defineProperty(ten, 'webkitRelativePath', { value: '资料/10.txt' })
    Object.defineProperty(two, 'webkitRelativePath', { value: '资料/2.txt' })

    const result = scanPickerFiles([ten, two], 'folder_picker')

    expect(result.files.map((item) => item.relativePath)).toEqual(['资料/2.txt', '资料/10.txt'])
  })

  it('applies hidden and depth guards to folder picker files', () => {
    const hidden = new File(['x'], '.secret', { type: 'text/plain' })
    const deep = new File(['x'], 'deep.txt', { type: 'text/plain' })
    Object.defineProperty(hidden, 'webkitRelativePath', { value: '资料/.secret' })
    Object.defineProperty(deep, 'webkitRelativePath', { value: `资料/${Array.from({ length: 9 }, (_, index) => `d${index}`).join('/')}/deep.txt` })

    const result = scanPickerFiles([hidden, deep], 'folder_picker')

    expect(result.files).toHaveLength(0)
    expect(result.skipped.map((item) => item.reason)).toEqual(['hidden', 'depth'])
  })

  it('does not enumerate after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const root = directoryEntry('资料', [[fileEntry('file.txt')], []])
    const dataTransfer = { items: [{ kind: 'file', getAsEntry: () => root, getAsFile: () => null }], files: [] } as unknown as DataTransfer

    const result = await scanDataTransfer(dataTransfer, controller.signal)

    expect(result.files).toHaveLength(0)
  })

  it('stops directory enumeration at the bounded scan limit and reports the known remainder', async () => {
    let reads = 0
    const batches = Array.from({ length: 8 }, (_, batch) =>
      Array.from({ length: 100 }, (_, index) => fileEntry(`${batch}-${index}.txt`))
    )
    const root: FakeEntry = {
      isFile: false,
      isDirectory: true,
      name: '大目录',
      createReader: () => ({
        readEntries: (success) => {
          reads += 1
          success(batches.shift() || [])
        }
      })
    }
    const dataTransfer = { items: [{ kind: 'file', getAsEntry: () => root, getAsFile: () => null }], files: [] } as unknown as DataTransfer

    const result = await scanDataTransfer(dataTransfer)

    expect(reads).toBeLessThan(8)
    expect(result.files).toHaveLength(499)
    expect(result.truncated).toBe(true)
    expect(result.skipped).toContainEqual(expect.objectContaining({ reason: 'scan_limit', count: 1, isMinimum: true }))
  })

  it.each(['../secret.txt', '/tmp/file.txt', 'C:/tmp/file.txt', '资料//file.txt', '资料/./file.txt'])('rejects unsafe path %s', (path) => {
    expect(normalizeRelativePath(path)).toBeNull()
  })
})
