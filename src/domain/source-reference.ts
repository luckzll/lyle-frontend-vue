const SOURCE_LABELS: Record<string, string> = {
  conversation: '由对话生成',
  knowledge: '来自知识库',
  project: '来自项目',
  automation: '由自动化生成',
  workflow: '由工作流生成',
  manual: '手动创建'
}

export function formatSourceReference(sourceRef?: string | null) {
  const value = (sourceRef || '').trim()
  if (!value) return ''

  const normalized = value.startsWith('source_ref:') ? value.slice('source_ref:'.length) : value
  const sourceType = normalized.split(':', 1)[0]?.toLowerCase()
  if (sourceType && SOURCE_LABELS[sourceType]) return SOURCE_LABELS[sourceType]

  // Opaque references are useful for diagnostics, but should not leak into the
  // default task experience. Advanced tools can continue to inspect the raw value.
  if (/^[a-z][\w-]*:/i.test(normalized)) return '由 Lyle 生成'
  return normalized.length > 48 ? '由 Lyle 生成' : normalized
}
