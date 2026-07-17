import { describe, expect, it } from 'vitest'
import { isMissionFrontendEnabledForConfig } from '@/features/mission'

describe('Mission frontend rollout flag', () => {
  it('is default-off and requires an explicit user allowlist', () => {
    expect(isMissionFrontendEnabledForConfig(false, new Set(['*']), '7')).toBe(false)
    expect(isMissionFrontendEnabledForConfig(true, new Set(), '7')).toBe(false)
    expect(isMissionFrontendEnabledForConfig(true, new Set(['8']), '7')).toBe(false)
    expect(isMissionFrontendEnabledForConfig(true, new Set(['7']), '7')).toBe(true)
    expect(isMissionFrontendEnabledForConfig(true, new Set(['*']), '7')).toBe(true)
  })
})
