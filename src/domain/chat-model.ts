export type ChatModelId = 'qwen3.7-flash' | 'qwen3.7-plus' | 'qwen3.8-max' | 'deepseek-v4-flash' | 'deepseek-v4-pro' | 'kimi-k3'

export interface ChatModelOption {
  id: ChatModelId
  name: string
  usage: string
  description: string
}

export const CHAT_MODEL_STORAGE_KEY = 'lyle.chat.model'
export const DEFAULT_CHAT_MODEL_ID: ChatModelId = 'qwen3.7-flash'

export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    id: 'qwen3.7-flash',
    name: 'Qwen 3.7 Flash',
    usage: '¥0.2 / ¥0.8',
    description: '每百万输入 / 输出 Token（32K 内），日常问答首选'
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    usage: '¥1 / ¥2',
    description: '每百万输入 / 输出 Token，推理速度与成本均衡'
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen 3.7 Plus',
    usage: '¥2 / ¥8',
    description: '每百万输入 / 输出 Token（256K 内），适合复杂通用任务'
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    usage: '¥12 / ¥24',
    description: '每百万输入 / 输出 Token，适合复杂推理和专业任务'
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen 3.8 Max',
    usage: '¥12 / ¥36',
    description: '每百万输入 / 输出 Token，旗舰能力，消耗最高'
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    usage: '¥20 / ¥100',
    description: '每百万输入 / 输出 Token，长上下文与复杂推理旗舰'
  }
]

export function resolveChatModelId(value: string | null | undefined): ChatModelId {
  return CHAT_MODEL_OPTIONS.some((option) => option.id === value)
    ? value as ChatModelId
    : DEFAULT_CHAT_MODEL_ID
}
