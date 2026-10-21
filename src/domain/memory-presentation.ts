import type { MemoryItem } from '@/api/types'
import type { MemorySchemaStatus } from '@/api/types'

// Keep the available categories aligned with app/memory/profile_schema.py.
export const MEMORY_CATEGORY_OPTIONS = [
  { value: 'identity.name', label: '姓名' },
  { value: 'identity.alias', label: '别名' },
  { value: 'identity.language', label: '语言' },
  { value: 'identity.zodiac', label: '星座' },
  { value: 'work.current_role', label: '当前角色' },
  { value: 'work.background', label: '背景' },
  { value: 'work.company_or_project', label: '公司或项目' },
  { value: 'work.working_style', label: '工作方式' },
  { value: 'preferences.food.likes', label: '喜欢的食物' },
  { value: 'preferences.food.dislikes', label: '不喜欢的食物' },
  { value: 'preferences.visual.likes', label: '视觉偏好' },
  { value: 'preferences.visual.dislikes', label: '视觉负向偏好' },
  { value: 'preferences.communication_style', label: '沟通风格' },
  { value: 'preferences.output_style', label: '输出风格' },
  { value: 'preferences.verbal_habits', label: '语言习惯' },
  { value: 'relationships.social_preferences', label: '社交偏好' },
  { value: 'relationships.social_style', label: '社交风格' },
  { value: 'interaction.boundaries', label: '互动边界' },
  { value: 'interaction.triggers', label: '应避免的互动触发点' },
  { value: 'preferences.travel.interests', label: '旅行兴趣' },
  { value: 'preferences.entertainment.likes', label: '娱乐偏好' },
  { value: 'preferences.entertainment.dislikes', label: '娱乐负向偏好' },
  { value: 'preferences.general.likes', label: '个人喜好' },
  { value: 'preferences.general.dislikes', label: '不喜欢的事物' },
  { value: 'goals.current_week', label: '本周目标' },
  { value: 'goals.current_month', label: '本月目标' },
  { value: 'goals.long_term', label: '长期目标' },
  { value: 'projects.current', label: '当前项目' },
  { value: 'projects.decisions', label: '项目决策' },
  { value: 'projects.open_questions', label: '开放问题' },
  { value: 'habits.routine', label: '日常习惯' },
  { value: 'habits.reminders', label: '提醒偏好' },
  { value: 'relationships.people', label: '重要关系' },
  { value: 'memory_control.forget_requests', label: '遗忘请求' },
  { value: 'memory_control.sensitive_info', label: '敏感信息' }
] as const

const MEMORY_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  MEMORY_CATEGORY_OPTIONS.map(({ value, label }) => [value, label])
)

const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  name: '姓名', identity: '身份', zodiac: '星座', career: '职业', role: '当前角色',
  current_project: '当前项目', project: '当前项目', goal: '目标', travel_interest: '旅行兴趣',
  food_preference: '食物偏好', food_negative_preference: '食物负向偏好',
  pet_preference: '宠物偏好', pet_negative_preference: '宠物负向偏好',
  sport_preference: '运动偏好', sport_negative_preference: '运动负向偏好',
  entertainment_preference: '娱乐偏好', entertainment_negative_preference: '娱乐负向偏好',
  preference: '偏好', negative_preference: '负向偏好', technology_stack: '技术栈',
  constraint: '限制条件', forget_request: '遗忘请求', sensitive_info: '敏感信息'
}

export function memoryCategoryLabel(item: MemoryItem): string {
  const target = memoryTargetKey(item).trim()
  const knownLabel = MEMORY_CATEGORY_LABELS[target] || LEGACY_CATEGORY_LABELS[target]
  if (knownLabel) return knownLabel

  const label = (item.label || '').trim()
  // Schema names and diagnostic identifiers must not become visible labels.
  return /^[\p{Script=Han} \t\d·、，。！？：；（）()《》「」『』—-]{1,40}$/u.test(label)
    && /\p{Script=Han}/u.test(label) && !/\d{5,}/.test(label) ? label : '个人记忆'
}

export function memoryCandidateSourceText(item: MemoryItem): string {
  for (const source of [item.sourceText, item.source, item.sourceRef]) {
    if (!source?.trim()) continue
    const excerpt = source
      // References may precede the excerpt on the same line or on a separate line.
      .replace(/\bsource_ref:[a-z][\w-]*:[^\s;\u3400-\u9fff]+(?:;[a-z][\w-]*:[^\s;\u3400-\u9fff]+)*/gi, '')
      .replace(/\b(?:conversation|message|knowledge|project|automation|workflow):[^\s;\u3400-\u9fff]+(?:;[a-z][\w-]*:[^\s;\u3400-\u9fff]+)*/gi, '')
      .replace(/^[\s;]+|[\s;]+$/g, '')
    if (!excerpt || /^(?:[a-z][\w-]*:[^\s]+|[a-z][\w-]*|\d{5,}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(excerpt)) continue
    return excerpt
  }
  return '本轮对话'
}

export function memorySchemaLabel(schema: MemorySchemaStatus): string {
  if (schema.enabled === false) return '当前使用兼容记忆模式'
  const previous = schema.factsEnabled ? '；核心画像仍按当前确认事实提供，详细记忆等待整理' : schema.version > 0 ? `；沿用第 ${schema.version} 版中仍有效的字段` : '；完成后才会用于长期记忆召回'
  if (schema.status === 'ready') return `记忆已整理 · 第 ${schema.version} 版 · ${schema.slotCount} 个槽位`
  if (schema.status === 'failed') return `记忆整理失败${previous}`
  if (schema.status === 'missing') return '尚未整理记忆，首次召回时会自动开始'
  return `记忆正在整理${previous}`
}

export function memoryReasonLabel(reason: string): string {
  return ({
    QUESTION_RELEVANT: '与你的问题直接相关',
    CORE_PROFILE: '本轮使用的精简核心画像',
    USER_REQUESTED_RECALL: '你明确要求回忆',
    PROJECT_CONTEXT: '当前项目上下文需要',
    ACTION_CONSTRAINT: '遵循你已确认的沟通偏好或互动边界'
  } as Record<string, string>)[reason] || '与你的问题相关'
}

export function memoryTargetKey(item: MemoryItem): string {
  const key = item.schemaPath ?? item.targetKey ?? item.key ?? ''
  return key.startsWith('pending:') ? key.split(':').slice(2).join(':') : key
}

export function setCandidateTargetKey(item: MemoryItem, value: string): void {
  // schemaPath is canonical and takes precedence when submitting the form.
  item.schemaPath = value.trim()
  item.targetKey = value.trim()
}
