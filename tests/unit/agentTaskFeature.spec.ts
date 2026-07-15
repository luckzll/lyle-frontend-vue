import { describe, expect, it } from 'vitest'
import { isAgentTaskFrontendEnabledForConfig } from '@/features/agentTask'

describe('Agent Task frontend rollout flag', () => {
  it('is default-off and requires an explicit user allowlist', () => {
    expect(isAgentTaskFrontendEnabledForConfig(false, new Set(['*']), '7')).toBe(false)
    expect(isAgentTaskFrontendEnabledForConfig(true, new Set(), '7')).toBe(false)
    expect(isAgentTaskFrontendEnabledForConfig(true, new Set(['8']), '7')).toBe(false)
    expect(isAgentTaskFrontendEnabledForConfig(true, new Set(['7']), '7')).toBe(true)
    expect(isAgentTaskFrontendEnabledForConfig(true, new Set(['*']), '7')).toBe(true)
  })
})
