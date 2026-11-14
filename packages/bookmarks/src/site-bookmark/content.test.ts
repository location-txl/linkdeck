import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock, runtimeSendMessage } from '@linkdeck/test-utils'
import { activeRulesFor, extractValue, installSiteBookmark } from './content'
import { SITE_BOOKMARK_SAVE } from './messages'
import { SITE_BOOKMARK_KEY, type SiteRule } from './types'

const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
const PAGE_URL = 'http://localhost:3000/'
const rule = (overrides: Partial<SiteRule> = {}): SiteRule => ({
  id: 'r1', domain: 'localhost', name: '测试站', enabled: true,
  triggerSelector: 'button[data-testid="star"]',
  containerSelector: 'article.card',
  url: { source: { kind: 'closestLink' } },
  title: { source: { kind: 'text', selector: 'h3 a' } },
  tagName: '测试', createdAt: 1, updatedAt: 1,
  ...overrides,
})
const fixture = () => {
  document.body.innerHTML = `
    <article class="card"><h3><a href="/posts/1">第一篇</a></h3><button data-testid="star">收藏</button></article>
    <article class="card"><h3><a href="/posts/2">第二篇</a></h3><button data-testid="star">收藏</button></article>
    <nav><button data-testid="star">导航收藏</button></nav>`
}
const cardButton = (index: number) => document.querySelectorAll('article.card button')[index] as HTMLButtonElement

let cleanups: Array<() => void> = []

beforeEach(() => {
  installChromeMock()
  fixture()
  runtimeSendMessage.mockResolvedValue({ ok: true, created: true })
})
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup())
  cleanups = []
  delete document.documentElement.dataset.linkdeckPicking
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('规则过滤与提取', () => {
  it('keeps enabled rules matching the host and its subdomains', () => {
    const rules = [rule({ domain: 'example.com', enabled: false }), rule({ domain: 'localhost' }), rule({ domain: 'other.test' })]
    expect(activeRulesFor(rules, 'sub.localhost').map(({ id }) => id)).toEqual(['r1'])
    expect(activeRulesFor([rule()], 'example.com')).toEqual([])
  })

  it('extracts from all built-in sources', () => {
    const card = document.querySelector('article.card')!
    const button = card.querySelector('button')!
    expect(extractValue({ source: { kind: 'closestLink' } }, button, card)).toBe('/posts/1')
    expect(extractValue({ source: { kind: 'pageUrl' } }, button, card)).toBe(PAGE_URL)
    expect(extractValue({ source: { kind: 'pageTitle' } }, button, card)).toBeUndefined()
    document.title = '站点首页'
    expect(extractValue({ source: { kind: 'pageTitle' } }, button, card)).toBe('站点首页')
    expect(extractValue({ source: { kind: 'text', selector: 'h3 a' } }, button, card)).toBe('第一篇')
    expect(extractValue({ source: { kind: 'attribute', selector: 'h3 a', attribute: 'href' } }, button, card)).toBe('/posts/1')
    expect(extractValue({ source: { kind: 'text', selector: 'h1' } }, button, card)).toBeUndefined()
    expect(extractValue({ source: { kind: 'text', selector: 'h3[' } }, button, card)).toBeUndefined()
  })

  it('post-processes with the first capture group and keeps unmatched values', () => {
    const card = document.querySelector('article.card')!
    const button = card.querySelector('button')!
    expect(extractValue({ source: { kind: 'text', selector: 'h3 a' }, pattern: '第(.+?)篇' }, button, card)).toBe('一')
    expect(extractValue({ source: { kind: 'text', selector: 'h3 a' }, pattern: '^第.+篇$' }, button, card)).toBe('第一篇')
    expect(extractValue({ source: { kind: 'text', selector: 'h3 a' }, pattern: '不存在' }, button, card)).toBe('第一篇')
    expect(extractValue({ source: { kind: 'text', selector: 'h3 a' }, pattern: '(' }, button, card)).toBe('第一篇')
  })
})

describe('站点收藏规则引擎', () => {
  it('saves the card content when its trigger button is clicked', async () => {
    cleanups.push(installSiteBookmark([rule()]))
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: SITE_BOOKMARK_SAVE, ruleId: 'r1', url: `${PAGE_URL}posts/1`, title: '第一篇' })
    cardButton(1).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(2)
    expect(runtimeSendMessage).toHaveBeenLastCalledWith({ type: SITE_BOOKMARK_SAVE, ruleId: 'r1', url: `${PAGE_URL}posts/2`, title: '第二篇' })
  })

  it('ignores clicks that hit no trigger and explains a mismatched container', async () => {
    cleanups.push(installSiteBookmark([rule()]))
    ;(document.querySelector('h3 a') as HTMLAnchorElement).click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    expect(document.querySelector('[role="status"]')).toBeNull()
    ;(document.querySelector('nav button') as HTMLButtonElement).click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('卡片容器')
  })

  it('falls back to the whole page when a rule has no container', async () => {
    document.title = '页面标题'
    cleanups.push(installSiteBookmark([rule({ containerSelector: undefined, url: { source: { kind: 'pageUrl' } }, title: { source: { kind: 'pageTitle' } } })]))
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: SITE_BOOKMARK_SAVE, ruleId: 'r1', url: PAGE_URL, title: '页面标题' })
  })

  it('does not intercept the website click behaviour', async () => {
    cleanups.push(installSiteBookmark([rule()]))
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    cardButton(0).dispatchEvent(event)
    await flush()
    expect(event.defaultPrevented).toBe(false)
  })

  it('surfaces extraction failures and retries failed saves', async () => {
    const mismatched = installSiteBookmark([rule({ triggerSelector: 'nav button', containerSelector: 'nav' })])
    ;(document.querySelector('nav button') as HTMLButtonElement).click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('未能从该页面提取链接')
    mismatched()

    runtimeSendMessage.mockResolvedValueOnce({ ok: false, error: '存储已满' })
    cleanups.push(installSiteBookmark([rule()]))
    cardButton(0).click()
    await flush()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('存储已满')
    ;(document.querySelector('[role="status"] button') as HTMLButtonElement).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['created a bookmark', { created: true }, '已收藏到 LinkDeck · 测试站'],
    ['merged the rule tag', { created: false, tagsMerged: true }, '已为 LinkDeck 收藏添加「测试」标签'],
    ['found an existing bookmark', { created: false, tagsMerged: false }, 'LinkDeck 中已收藏这个链接'],
  ])('notifies when the background %s', async (_name, response, expected) => {
    runtimeSendMessage.mockResolvedValueOnce({ ok: true, ...response })
    cleanups.push(installSiteBookmark([rule()]))
    cardButton(0).click()
    await flush()
    expect(document.querySelector('[role="status"]')?.textContent).toContain(expected)
  })

  it('skips saves while the picker is selecting on the page', async () => {
    cleanups.push(installSiteBookmark([rule()]))
    document.documentElement.dataset.linkdeckPicking = ''
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    delete document.documentElement.dataset.linkdeckPicking
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: SITE_BOOKMARK_SAVE, ruleId: 'r1', url: `${PAGE_URL}posts/1`, title: '第一篇' })
  })
})

describe('站点收藏脚本初始化', () => {
  const scope = globalThis as typeof globalThis & { linkdeckSiteBookmarkCleanup?: () => void }
  const inject = async () => {
    vi.resetModules()
    await import('./content')
    await flush()
  }

  afterEach(() => {
    scope.linkdeckSiteBookmarkCleanup?.()
    delete scope.linkdeckSiteBookmarkCleanup
  })

  it('installs rules from storage and follows updates', async () => {
    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: true, rules: [rule()] } })
    await inject()
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: SITE_BOOKMARK_SAVE, ruleId: 'r1', url: `${PAGE_URL}posts/1`, title: '第一篇' })

    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: true, rules: [] } })
    await flush()
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not install listeners while the master switch is off', async () => {
    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: false, rules: [rule()] } })
    await inject()
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()

    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: true, rules: [rule()] } })
    await flush()
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: SITE_BOOKMARK_SAVE, ruleId: 'r1', url: `${PAGE_URL}posts/1`, title: '第一篇' })
  })

  it('injects only once and stops on demand', async () => {
    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: true, rules: [rule()] } })
    await inject()
    await inject()
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    scope.linkdeckSiteBookmarkCleanup?.()
    delete scope.linkdeckSiteBookmarkCleanup
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
  })

  it('does nothing on pages without matching rules', async () => {
    await inject()
    cardButton(0).click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
  })
})
