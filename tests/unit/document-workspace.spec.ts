import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { newDocumentDraft, checkpoint, updateDraft, restoreVersion, documentTarget, documentEditPrompt, applyDocumentReply } from '../../src/domain/document-workspace'
import { createDocumentBlob } from '../../src/domain/document-export'
import { presentationPages } from '../../src/domain/office-draft-export'

describe('document editing and generated Office files', () => {
  it('applies a selected range, saves the previous version and restores it', () => {
    const draft = newDocumentDraft('甲乙丙丁', '项目')
    const target = documentTarget(draft, 1, 3)
    expect(documentEditPrompt('简化', target)).toContain('乙丙')
    applyDocumentReply(draft, target, '新内容')
    expect(draft.content).toBe('甲新内容丁')
    expect(draft.versions).toHaveLength(2)
    restoreVersion(draft, draft.versions[0]!)
    expect(draft.content).toBe('甲乙丙丁')
    expect(draft.versions[1]!.content).toBe('甲新内容丁')
  })
  it('rejects stale replies even if content has been changed back to the original', () => {
    const draft = newDocumentDraft('原文', '文档'); const target = documentTarget(draft)
    updateDraft(draft, '新文'); updateDraft(draft, '原文')
    expect(() => applyDocumentReply(draft, target, '迟到回复')).toThrow('已发生变化')
    expect(draft.content).toBe('原文')
    expect(() => documentEditPrompt('改写', { ...target, text: 'x'.repeat(30001) })).toThrow('3 万字')
  })
  it('keeps unsaved edits before restoration and bounds the history without reusing version numbers', () => {
    const draft = newDocumentDraft('初始', '文档')
    updateDraft(draft, '未存版本的修改'); restoreVersion(draft, draft.versions[0]!)
    expect(draft.versions[1]!.content).toBe('未存版本的修改')
    for (let n = 0; n < 25; n++) { updateDraft(draft, `版本 ${n}`); checkpoint(draft) }
    expect(draft.versions).toHaveLength(20)
    expect(draft.versions.at(-1)!.number).toBe(28)
  })
  it('generates XLSX literal cells with Chinese text, empty columns and formula-like strings intact', async () => {
    const blob = await createDocumentBlob('| 名称 | 空列 | 金额 |\n| --- | --- | --- |\n| 中文 | | =HYPERLINK("https://example.com") |', 'xlsx', '预算')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    const strings = await zip.file('xl/sharedStrings.xml')!.async('string')
    expect(strings).toContain('中文'); expect(strings).toContain('HYPERLINK')
    expect(sheet).toContain('r="C2"'); expect(sheet).not.toContain('<f>')
    expect(zip.file('xl/workbook.xml')).not.toBeNull()
  })
  it('creates real PPTX slides and paginates long text instead of dropping it', async () => {
    const pages = presentationPages('# 标题\n' + '内容'.repeat(450), '报告')
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.map(page => page.body.replaceAll('\n', '')).join('')).toBe('内容'.repeat(450))
    const blob = await createDocumentBlob('# 项目计划\n第一阶段：调研\n\n## 实施\n第二阶段：落地', 'pptx', '计划')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('项目计划')
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('落地')
    expect(zip.file('ppt/presentation.xml')).not.toBeNull()
  })
})
