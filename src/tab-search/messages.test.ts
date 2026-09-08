import { describe, expect, it } from 'vitest'
import { isTabSearchMessage } from './messages'

describe('tab search messages', () => {
  it('accepts history query and open messages', () => {
    expect(isTabSearchMessage({ type: 'tab-search:get-history', query: '' })).toBe(true)
    expect(isTabSearchMessage({ type: 'tab-search:get-history', query: 'github' })).toBe(true)
    expect(isTabSearchMessage({ type: 'tab-search:open-history', url: 'https://example.com/' })).toBe(true)
  })

  it('rejects malformed history messages', () => {
    expect(isTabSearchMessage({ type: 'tab-search:get-history' })).toBe(false)
    expect(isTabSearchMessage({ type: 'tab-search:get-history', query: 123 })).toBe(false)
    expect(isTabSearchMessage({ type: 'tab-search:open-history', url: '  ' })).toBe(false)
  })
})
