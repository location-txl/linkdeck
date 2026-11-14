import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLocalStore, installChromeMock } from '@linkdeck/test-utils'
import { installPicker } from './picker'
import { buildSelector } from './rules'
import { MAX_SITE_RULES, SITE_BOOKMARK_KEY, type SiteRule } from './types'

const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
const fixture = () => {
  document.body.innerHTML = `
    <aside><button id="like">点赞</button></aside>
    <main><article class="card"><h3><a href="/posts/1">标题</a></h3><button data-testid="star">收藏</button></article></main>
    <footer>页脚</footer>`
}
const dispatchClick = (element: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}
const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
const bannerText = () => document.querySelector('[data-linkdeck-picker] > div')?.textContent ?? ''
const formInput = (name: string) => document.querySelector<HTMLInputElement>(`[data-linkdeck-${name}]`)!
const saveRule = async () => {
  ;(document.querySelector('[data-linkdeck-save]') as HTMLButtonElement).click()
  await flush()
}

let cleanup: (() => void) | undefined
const baseRule = (index: number): SiteRule => ({
  id: `rule-${index}`, domain: 'localhost', name: 'localhost', enabled: true,
  triggerSelector: 'button', url: { source: { kind: 'pageUrl' } }, title: { source: { kind: 'pageTitle' } },
  tagName: 'local', createdAt: index, updatedAt: index,
})

beforeEach(() => {
  installChromeMock()
  fixture()
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

describe('元素选取器', () => {
  it('guides through trigger and container picks without firing page clicks', () => {
    cleanup = installPicker()!
    expect(bannerText()).toContain('①')
    const triggerClick = dispatchClick(document.querySelector('[data-testid="star"]')!)
    expect(triggerClick.defaultPrevented).toBe(true)
    expect(bannerText()).toContain('②')

    const containerClick = dispatchClick(document.querySelector('article.card')!)
    expect(containerClick.defaultPrevented).toBe(true)
    expect(formInput('trigger').value).toBe(buildSelector(document.querySelector('[data-testid="star"]')!))
    expect(formInput('container').value).toBe(buildSelector(document.querySelector('article.card')!))
    expect(formInput('tag').value).toBe('localhost')
  })

  it('rejects container picks that do not contain the trigger', () => {
    cleanup = installPicker()!
    dispatchClick(document.querySelector('[data-testid="star"]')!)
    dispatchClick(document.querySelector('footer')!)
    expect(bannerText()).toContain('不包含')
    expect(document.querySelector('[data-linkdeck-trigger]')).toBeNull()
  })

  it('allows skipping the container with Escape and saves a whole-page rule', async () => {
    cleanup = installPicker()!
    dispatchClick(document.querySelector('[data-testid="star"]')!)
    pressEscape()
    expect(formInput('container').value).toBe('')
    const triggerSelector = formInput('trigger').value
    await saveRule()
    const stored = getLocalStore()[SITE_BOOKMARK_KEY] as { enabled: boolean; rules: SiteRule[] }
    expect(stored.enabled).toBe(true)
    expect(stored.rules).toHaveLength(1)
    expect(stored.rules[0]).toMatchObject({
      domain: 'localhost', triggerSelector,
      url: { source: { kind: 'pageUrl' } }, title: { source: { kind: 'pageTitle' } },
    })
    expect(document.querySelector('[data-linkdeck-picker]')).toBeNull()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('规则已保存')
  })

  it('saves a card rule with the closest-link source', async () => {
    cleanup = installPicker()!
    dispatchClick(document.querySelector('[data-testid="star"]')!)
    dispatchClick(document.querySelector('article.card')!)
    await saveRule()
    const stored = getLocalStore()[SITE_BOOKMARK_KEY] as { enabled: boolean; rules: SiteRule[] }
    expect(stored.rules[0]).toMatchObject({
      containerSelector: buildSelector(document.querySelector('article.card')!),
      url: { source: { kind: 'closestLink' } },
    })
  })

  it('updates match counts while editing selectors and blocks invalid saves', async () => {
    cleanup = installPicker()!
    dispatchClick(document.querySelector('[data-testid="star"]')!)
    pressEscape()
    const triggerInput = formInput('trigger')
    expect(document.querySelector('[data-linkdeck-trigger-count]')?.textContent).toContain('命中 1 个元素')
    triggerInput.value = 'button[data-testid="star"], aside button'
    triggerInput.dispatchEvent(new Event('input'))
    expect(document.querySelector('[data-linkdeck-trigger-count]')?.textContent).toContain('命中 2 个元素')

    triggerInput.value = 'button['
    triggerInput.dispatchEvent(new Event('input'))
    await saveRule()
    expect(document.querySelector('[data-linkdeck-error]')?.textContent).toContain('请填写有效的触发按钮选择器')
    expect(getLocalStore()[SITE_BOOKMARK_KEY]).toBeUndefined()
  })

  it('stops entirely on Escape during the trigger step', () => {
    cleanup = installPicker()!
    pressEscape()
    expect(document.querySelector('[data-linkdeck-picker]')).toBeNull()
    expect(cleanup).toBeDefined()
  })

  it('marks the page while picking and clears the mark on every exit path', async () => {
    cleanup = installPicker()!
    expect(document.documentElement.hasAttribute('data-linkdeck-picking')).toBe(true)
    pressEscape()
    expect(document.documentElement.hasAttribute('data-linkdeck-picking')).toBe(false)

    cleanup = installPicker()!
    dispatchClick(document.querySelector('[data-testid="star"]')!)
    pressEscape()
    await saveRule()
    expect(document.documentElement.hasAttribute('data-linkdeck-picking')).toBe(false)
  })

  it('clears the session guard on exit so the picker can be re-injected', () => {
    const scope = globalThis as typeof globalThis & { linkdeckSiteBookmarkPickerCleanup?: () => void }
    delete scope.linkdeckSiteBookmarkPickerCleanup
    // 内部退出路径（Esc / 取消 / 保存成功）与外部清理走同一个 cleanup。
    cleanup = installPicker()!
    scope.linkdeckSiteBookmarkPickerCleanup = cleanup
    pressEscape()
    expect(scope.linkdeckSiteBookmarkPickerCleanup).toBeUndefined()
    expect(document.querySelector('[data-linkdeck-picker]')).toBeNull()

    cleanup = installPicker()!
    scope.linkdeckSiteBookmarkPickerCleanup = cleanup
    scope.linkdeckSiteBookmarkPickerCleanup()
    expect(scope.linkdeckSiteBookmarkPickerCleanup).toBeUndefined()
  })

  it('refuses to exceed the rule limit', async () => {
    const rules = Array.from({ length: MAX_SITE_RULES }, (_, index) => baseRule(index))
    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: true, rules } })
    cleanup = installPicker()!
    dispatchClick(document.querySelector('[data-testid="star"]')!)
    pressEscape()
    await saveRule()
    expect(document.querySelector('[data-linkdeck-error]')?.textContent).toContain('上限')
    expect((getLocalStore()[SITE_BOOKMARK_KEY] as { rules: SiteRule[] }).rules).toHaveLength(MAX_SITE_RULES)
    expect(document.querySelector('[data-linkdeck-picker]')).not.toBeNull()
  })
})
