import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildSelector, defaultTagName, matchesSite, normalizeSiteBookmarkSettings, normalizeSiteDomain, siteOrigins,
} from './rules'
import { MAX_SITE_RULES, type SiteRule } from './types'

const baseRule = {
  id: 'rule-1',
  domain: 'github.com',
  name: 'GitHub',
  enabled: true,
  triggerSelector: 'button[data-testid="star"]',
  url: { source: { kind: 'pageUrl' as const } },
  title: { source: { kind: 'pageTitle' as const } },
  tagName: 'GitHub',
  createdAt: 1,
  updatedAt: 2,
}

describe('站点域名工具', () => {
  it('normalizes domains from input or URLs and rejects other schemes', () => {
    expect(normalizeSiteDomain('GitHub.com')).toBe('github.com')
    expect(normalizeSiteDomain('https://docs.github.com/pulls?q=1')).toBe('docs.github.com')
    expect(normalizeSiteDomain('chrome://settings')).toBeUndefined()
    expect(normalizeSiteDomain('user:pass@example.com')).toBeUndefined()
    expect(normalizeSiteDomain('example.com.evil.test')).toBe('example.com.evil.test')
  })
  it('matches exact domains and subdomains only', () => {
    expect(matchesSite('github.com', 'github.com')).toBe(true)
    expect(matchesSite('docs.github.com', 'github.com')).toBe(true)
    expect(matchesSite('github.com.evil.test', 'github.com')).toBe(false)
  })
  it('shares origin patterns between permissions and script registration', () => {
    expect(siteOrigins('github.com')).toEqual(['http://*.github.com/*', 'https://*.github.com/*'])
    expect(siteOrigins('192.168.1.4')).toEqual(['http://192.168.1.4/*', 'https://192.168.1.4/*'])
  })
  it('derives the default tag name from the domain', () => {
    expect(defaultTagName('github.com')).toBe('github')
    expect(defaultTagName('192.168.1.4')).toBe('192.168.1.4')
  })
})

describe('站点收藏规则读取', () => {
  it('keeps valid rules and fills defaults for optional fields', () => {
    const settings = normalizeSiteBookmarkSettings({
      enabled: true,
      rules: [{ ...baseRule, name: undefined, tagName: undefined, containerSelector: '' }],
    })
    expect(settings.enabled).toBe(true)
    expect(settings.rules).toHaveLength(1)
    expect(settings.rules[0]).toMatchObject({ name: 'github.com', tagName: 'github', enabled: true })
    expect('containerSelector' in settings.rules[0]).toBe(false)
  })
  it.each([
    ['missing id', { ...baseRule, id: '' }],
    ['invalid domain', { ...baseRule, domain: 'not a domain' }],
    ['empty trigger selector', { ...baseRule, triggerSelector: '  ' }],
    ['invalid url source kind', { ...baseRule, url: { source: { kind: 'pageTitle' } } }],
    ['text source without selector', { ...baseRule, title: { source: { kind: 'text' } } }],
    ['attribute source without name', { ...baseRule, title: { source: { kind: 'attribute', selector: 'h1' } } }],
    ['invalid regex pattern', { ...baseRule, title: { source: { kind: 'pageTitle' }, pattern: '(' } }],
  ])('drops rules with %s', (_name, rule) => {
    expect(normalizeSiteBookmarkSettings({ enabled: true, rules: [rule] }).rules).toHaveLength(0)
  })
  it('caps stored rules at the limit and resets invalid payloads', () => {
    const rules = Array.from({ length: MAX_SITE_RULES + 5 }, (_, index) => ({ ...baseRule, id: `rule-${index}` }))
    expect(normalizeSiteBookmarkSettings({ enabled: true, rules }).rules).toHaveLength(MAX_SITE_RULES)
    expect(normalizeSiteBookmarkSettings('broken')).toEqual({ enabled: false, rules: [] })
  })
})

describe('buildSelector', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  it('prefers unique ids', () => {
    document.body.innerHTML = '<div id="app"><button id="save-btn">收藏</button></div>'
    expect(buildSelector(document.getElementById('save-btn')!)).toBe('#save-btn')
  })
  it('falls back to data-testid descriptors', () => {
    document.body.innerHTML = '<article><button data-testid="star">收藏</button></article>'
    expect(buildSelector(document.querySelector('button')!)).toBe('button[data-testid="star"]')
  })
  it('adds ancestor levels until the selector is unique', () => {
    document.body.innerHTML = '<div><section><button>a</button></section></div><aside><button>b</button></aside>'
    expect(buildSelector(document.querySelector('aside button')!)).toBe('aside:nth-of-type(1) > button:nth-of-type(1)')
  })
  it('downgrades duplicated ids to positional segments', () => {
    document.body.innerHTML = '<p><button id="dup">a</button></p><p><button id="dup">b</button></p>'
    const selector = buildSelector(document.querySelectorAll('button')[1]!)
    expect([...document.querySelectorAll(selector)]).toEqual([document.querySelectorAll('button')[1]])
  })
  it('returns a usable selector when uniqueness needs no extra levels', () => {
    document.body.innerHTML = '<main><button>only</button></main>'
    expect(buildSelector(document.querySelector('button')!)).toBe('button:nth-of-type(1)')
    expect(document.querySelectorAll('button:nth-of-type(1)')).toHaveLength(1)
  })
})

describe('SiteRule 类型约束', () => {
  it('round-trips a full rule with a container and regex', () => {
    const rule: SiteRule = {
      ...baseRule,
      containerSelector: 'article.card',
      url: { source: { kind: 'attribute' as const, selector: 'a.link', attribute: 'href' }, pattern: 'https://' },
      title: { source: { kind: 'text' as const, selector: 'h3' }, pattern: '(.+?) -' },
    }
    const settings = normalizeSiteBookmarkSettings({ enabled: true, rules: [rule] })
    expect(settings.rules[0]).toEqual(rule)
  })
})
