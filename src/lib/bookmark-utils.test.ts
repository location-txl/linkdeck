import { describe, expect, it } from 'vitest'
import {
  UserFacingError,
  getHostname,
  makeFaviconUrl,
  normalizeUrl,
  validateGroupName,
} from './bookmark-utils'

describe('bookmark utilities', () => {
  it('normalizes a URL without a protocol', () => {
    expect(normalizeUrl('github.com/openai/codex')).toBe('https://github.com/openai/codex')
  })

  it('rejects unsupported protocols', () => {
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow(UserFacingError)
    expect(() => normalizeUrl('chrome://settings')).toThrow('只支持 http 或 https 网址。')
  })

  it('uses only the hostname in the favicon request', () => {
    const url = 'https://docs.example.com/path/to/page?token=private#fragment'
    expect(getHostname(url)).toBe('docs.example.com')
    expect(makeFaviconUrl(url)).toBe(
      'https://a.favicon.im/docs.example.com?throw-error-on-404=true',
    )
  })

  it('trims and validates group names', () => {
    expect(validateGroupName('  工作  ')).toBe('工作')
    expect(() => validateGroupName('')).toThrow('请输入分组名称。')
  })
})
