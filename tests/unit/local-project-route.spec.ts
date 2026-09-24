import { describe, expect, it } from 'vitest'
import { canonicalLocalProjectQuery, parseLocalProjectRoute } from '@/domain/local-project-route'

describe('local project navigation contract', () => {
  it('supports old URLs, project-only URLs and standalone orphan session links', () => {
    expect(parseLocalProjectRoute({})).toEqual({ projectId: null, sessionId: null, action: null, request: null, error: null })
    expect(parseLocalProjectRoute({ projectId: 'project-a' })).toMatchObject({ projectId: 'project-a', sessionId: null, error: null })
    expect(parseLocalProjectRoute({ sessionId: 'orphan-a' })).toMatchObject({ projectId: null, sessionId: 'orphan-a', error: null })
  })
  it('requires an explicit fresh request token for actions', () => {
    expect(parseLocalProjectRoute({ action: 'new-chat', projectId: 'a', request: 'click-1' })).toMatchObject({ action: 'new-chat', projectId: 'a', request: 'click-1', error: null })
    expect(parseLocalProjectRoute({ action: 'add-project', request: 'click-2' })).toMatchObject({ action: 'add-project', error: null })
    expect(parseLocalProjectRoute({ action: 'add-project' })).toMatchObject({ action: null, error: expect.any(String) })
    expect(parseLocalProjectRoute({ action: 'new-chat', request: 'click-1' })).toMatchObject({ action: null, error: expect.any(String) })
  })
  it.each([
    { projectId: ['a', 'b'] }, { sessionId: ['s'] }, { projectId: null }, { projectId: '' },
    { sessionId: ' '.repeat(2) }, { sessionId: 's'.repeat(257) }, { action: 'delete-project' },
    { action: 'new-chat', projectId: 'a', request: 'n', sessionId: 's' },
  ])('rejects ambiguous or unsafe requests: %j', query => {
    expect(parseLocalProjectRoute(query)).toMatchObject({ action: null, error: expect.any(String) })
  })
  it('canonicalizes selection without retaining one-time actions or stale query keys', () => {
    expect(canonicalLocalProjectQuery('p', 's')).toEqual({ projectId: 'p', sessionId: 's' })
    expect(canonicalLocalProjectQuery(null, 's')).toEqual({ sessionId: 's' })
    expect(canonicalLocalProjectQuery('p', null)).toEqual({ projectId: 'p' })
    expect(canonicalLocalProjectQuery(null, null)).toEqual({})
  })
})
