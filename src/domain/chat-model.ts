export type ChatModelId = 'qwen-fast' | 'gpt-5.4' | 'gpt-5.5' | 'claude-sonnet-4.6' | 'gemini-3.1-pro'

export interface ChatModelOption {
  id: ChatModelId
  name: string
  usage: string
  description: string
}

export const CHAT_MODEL_STORAGE_KEY = 'lyle.chat.model'
export const DEFAULT_CHAT_MODEL_ID: ChatModelId = 'qwen-fast'

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    id: 'qwen-fast',
    name: 'Qwen 3.5 Flash',
    usage: '省 Token',
    description: '响应快，适合日常问答和简单整理'
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    usage: '中等消耗',
    description: '能力与成本均衡，适合大多数复杂任务'
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    usage: '较高消耗',
    description: '复杂推理和专业任务更强，速度与费用更高'
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    usage: '中高消耗',
    description: '擅长长文、代码和多步骤任务'
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    usage: '中高消耗',
    description: '适合长上下文理解和综合分析'
  }
]

export function resolveChatModelId(value: string | null | undefined): ChatModelId {
  return CHAT_MODEL_OPTIONS.some((option) => option.id === value)
    ? value as ChatModelId
    : DEFAULT_CHAT_MODEL_ID
}
