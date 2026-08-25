export type ChatModelId = 'qwen3.7-flash' | 'qwen3.7-plus' | 'qwen3.8-max' | 'deepseek-v4-flash' | 'deepseek-v4-pro' | 'kimi-k3'

export interface ChatModelOption {
  id: ChatModelId
  name: string
  description: string
}

export const CHAT_MODEL_STORAGE_KEY = 'lyle.chat.model'
export const DEFAULT_CHAT_MODEL_ID: ChatModelId = 'qwen3.7-flash'

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    id: 'qwen3.7-flash',
    name: 'Qwen 3.7 Flash',
    description: '速度优先，适合日常问答'
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: '响应迅速，适合轻量推理'
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen 3.7 Plus',
    description: '能力均衡，适合复杂通用任务'
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: '擅长复杂推理与专业分析'
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen 3.8 Max',
    description: '旗舰能力，适合高质量回答'
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    description: '长上下文与复杂推理'
  }
]

export function resolveChatModelId(value: string | null | undefined): ChatModelId {
  return CHAT_MODEL_OPTIONS.some((option) => option.id === value)
    ? value as ChatModelId
    : DEFAULT_CHAT_MODEL_ID
}
