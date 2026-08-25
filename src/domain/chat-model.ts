export type ChatModelId = 'qwen3.7-flash' | 'gpt-5.5' | 'claude-opus-4.6' | 'gemini-3.5-flash' | 'qwen3.7-plus' | 'qwen3.8-max' | 'deepseek-v4-flash' | 'deepseek-v4-pro' | 'kimi-k3'

export interface ChatModelOption {
  id: ChatModelId
  name: string
  description: string
  disabledReason?: string
}

export const CHAT_MODEL_STORAGE_KEY = 'lyle.chat.model'
export const DEFAULT_CHAT_MODEL_ID: ChatModelId = 'qwen3.7-flash'

const MODEL_CONNECTION_ERROR_MARKERS = [
  '当前模型暂时无法连接',
  '模型服务暂时不可用',
  'network is unreachable',
  'connection error'
]

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    id: 'qwen3.7-flash',
    name: 'Qwen 3.7 Flash',
    description: '速度优先，适合日常问答'
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: '高质量推理与复杂专业任务',
    disabledReason: '生产服务器暂时无法连接 ZenMux'
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    description: '长文写作、分析与代码任务',
    disabledReason: '生产服务器暂时无法连接 ZenMux'
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: '多模态理解与快速回答',
    disabledReason: '生产服务器暂时无法连接 ZenMux'
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
  const selected = CHAT_MODEL_OPTIONS.find((option) => option.id === value)
  return selected && !selected.disabledReason ? selected.id : DEFAULT_CHAT_MODEL_ID
}

export function isChatModelAvailable(modelId: ChatModelId) {
  return !CHAT_MODEL_OPTIONS.find((option) => option.id === modelId)?.disabledReason
}

export function isChatModelConnectionError(message: string | null | undefined) {
  const normalized = String(message || '').trim().toLowerCase()
  return MODEL_CONNECTION_ERROR_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()))
}
