import { describe, expect, it } from 'vitest'
import {
  isKnowledgeFileSupported,
  KNOWLEDGE_FILE_ACCEPT,
  knowledgeFileExtension
} from '../../src/domain/knowledge-file'

describe('knowledge file support', () => {
  it.each(['brief.pdf', 'plan.docx', 'metrics.xlsx', 'legacy.xls', 'deck.pptx', 'notes.md'])(
    'accepts %s',
    (fileName) => expect(isKnowledgeFileSupported(fileName)).toBe(true)
  )

  it('normalizes uppercase extensions and rejects unsupported files', () => {
    expect(knowledgeFileExtension('Quarterly.Report.PPTX')).toBe('.pptx')
    expect(isKnowledgeFileSupported('Quarterly.Report.PPTX')).toBe(true)
    expect(isKnowledgeFileSupported('archive.zip')).toBe(false)
    expect(isKnowledgeFileSupported('README')).toBe(false)
  })

  it('advertises the main office formats to the native picker', () => {
    expect(KNOWLEDGE_FILE_ACCEPT).toContain('.pdf')
    expect(KNOWLEDGE_FILE_ACCEPT).toContain('.docx')
    expect(KNOWLEDGE_FILE_ACCEPT).toContain('.xlsx')
    expect(KNOWLEDGE_FILE_ACCEPT).toContain('.pptx')
  })
})
