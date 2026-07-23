import { describe, expect, it } from 'vitest'
import { resolveAuthRedirect, safeRedirect } from '@/domain/auth-redirect'

describe('safeRedirect', () => {
  it('keeps safe in-app paths including query and hash', () => {
    expect(safeRedirect('/projects/12?tab=files#latest')).toBe('/projects/12?tab=files#latest')
    expect(safeRedirect('%2Fconversations%3Fid%3D8')).toBe('/conversations?id=8')
  })

  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '/login',
    '/login?redirect=/projects',
    '%E0%A4%A'
  ])('rejects unsafe redirect %s', (value) => {
    expect(safeRedirect(value)).toBe('/dashboard')
  })
})

describe('resolveAuthRedirect', () => {
  it('classifies missing, accepted, and rejected return targets for metrics', () => {
    expect(resolveAuthRedirect(undefined)).toEqual({ target: '/dashboard', status: 'skipped' })
    expect(resolveAuthRedirect('%2Fprojects%2F7')).toEqual({ target: '/projects/7', status: 'succeeded' })
    expect(resolveAuthRedirect('https://evil.test')).toEqual({ target: '/dashboard', status: 'rejected' })
  })
})
