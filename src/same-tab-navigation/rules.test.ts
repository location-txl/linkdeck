import { describe, expect, it } from 'vitest'
import { allowsNavigation, findSiteRule, matchesSite, normalizeSameTabSettings, normalizeSiteDomain, siteOrigins } from './rules'

describe('当前标签页网站规则', () => {
  it('normalizes domains and rejects special protocols and malformed inputs', () => {
    expect(normalizeSiteDomain(' https://SCYS.com./article?id=1 ')).toBe('scys.com')
    expect(normalizeSiteDomain('docs.example.com')).toBe('docs.example.com')
    for (const input of ['', 'chrome://settings', 'javascript:alert(1)', 'https://a..com', 'https://user:secret@example.com', 'bad domain']) {
      expect(normalizeSiteDomain(input)).toBeUndefined()
    }
    expect(siteOrigins('scys.com')).toEqual(['http://*.scys.com/*', 'https://*.scys.com/*'])
    expect(siteOrigins('127.0.0.1')).toEqual(['http://127.0.0.1/*', 'https://127.0.0.1/*'])
  })

  it('matches subdomains with boundaries and uses the most specific rule', () => {
    expect(matchesSite('docs.scys.com', 'scys.com')).toBe(true)
    expect(matchesSite('scys.com.evil.test', 'scys.com')).toBe(false)
    expect(matchesSite('evilscys.com', 'scys.com')).toBe(false)
    expect(matchesSite('a.127.0.0.1', '127.0.0.1')).toBe(false)
    const settings = { enabled: true, sites: [{ domain: 'scys.com', scope: 'all' as const }, { domain: 'docs.scys.com', scope: 'site' as const }] }
    expect(findSiteRule(settings, 'a.docs.scys.com')).toEqual(settings.sites[1])
    expect(findSiteRule({ ...settings, enabled: false }, 'scys.com')).toBeNull()
    expect(findSiteRule(settings, 'feishu.cn')).toBeNull()
  })

  it('limits destinations according to the source rule and permits relative links', () => {
    const rule = { domain: 'scys.com', scope: 'site' as const }
    expect(allowsNavigation(rule, '/article/1', 'https://scys.com')).toBe(true)
    expect(allowsNavigation(rule, 'https://docs.scys.com/a', 'https://scys.com')).toBe(true)
    expect(allowsNavigation(rule, 'https://feishu.cn/a', 'https://scys.com')).toBe(false)
    expect(allowsNavigation({ ...rule, scope: 'all' }, 'https://feishu.cn/a', 'https://scys.com')).toBe(true)
    expect(allowsNavigation({ ...rule, scope: 'all' }, 'mailto:a@example.com', 'https://scys.com')).toBe(false)
    expect(allowsNavigation(null, '/article/1', 'https://scys.com')).toBe(false)
  })

  it('ignores malformed storage and deduplicates valid rules', () => {
    expect(normalizeSameTabSettings(null)).toEqual({ enabled: false, sites: [] })
    expect(normalizeSameTabSettings({ enabled: true, sites: [null, { domain: 'SCYS.com', scope: 'all' }, { domain: 'scys.com', scope: 'site' }, { domain: 'other.com', scope: 'invalid' }] }))
      .toEqual({ enabled: true, sites: [{ domain: 'scys.com', scope: 'all' }] })
  })
})
