import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { TabSearchHistoryItem, TabSearchMessage, TabSearchResponse, TabSearchTab } from './messages'

const HOST_ID = 'linkdeck-tab-search-root'

function createTab(overrides: Partial<TabSearchTab> = {}): TabSearchTab {
  return {
    id: 1,
    index: 0,
    title: 'GitHub',
    url: 'https://github.com/',
    active: true,
    pinned: false,
    ...overrides,
  }
}

function createHistory(overrides: Partial<TabSearchHistoryItem> = {}): TabSearchHistoryItem {
  return {
    id: 'history-1',
    title: '历史页面',
    url: 'https://history.example/guide',
    lastVisitTime: Date.now() - 5 * 60_000,
    ...overrides,
  }
}

async function loadOverlay(tabs: TabSearchTab[], history: TabSearchHistoryItem[] = []) {
  const attachShadow = vi.spyOn(HTMLElement.prototype, 'attachShadow')
  const sendMessage = vi.fn(async (message: TabSearchMessage): Promise<TabSearchResponse> => {
    if (message.type === 'tab-search:get-tabs') return { ok: true, tabs }
    if (message.type === 'tab-search:get-history') return { ok: true, history }
    return { ok: true }
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  await import('./content')

  const host = document.getElementById(HOST_ID)
  const shadow = attachShadow.mock.results[0]?.value as ShadowRoot | undefined
  expect(shadow).toBeTruthy()
  await waitFor(() => expect(shadow?.querySelectorAll('[role="option"]')).toHaveLength(Math.min(tabs.length, 50)))
  return { host: host!, shadow: shadow!, sendMessage }
}

describe('tab search overlay', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.getElementById(HOST_ID)?.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mounts one Shadow DOM overlay, focuses the search field, and caps visible rows', async () => {
    const tabs = Array.from({ length: 60 }, (_, index) => createTab({ id: index + 1, index, title: `Tab ${index}` }))
    const { host, shadow } = await loadOverlay(tabs)
    const input = shadow.querySelector('input')

    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1)
    expect(shadow.querySelectorAll('[role="option"]')).toHaveLength(50)
    expect(shadow.activeElement).toBe(input)
    expect(host.shadowRoot).toBeNull()
  })

  it('keeps the outside click target transparent without dimming the page', async () => {
    const { shadow } = await loadOverlay([createTab()])
    const styleText = shadow.querySelector('style')?.textContent ?? ''
    const backdropRule = styleText.match(/\.tab-search__backdrop \{([\s\S]*?)\}/)?.[1] ?? ''

    expect(backdropRule).toContain('background: transparent;')
    expect(backdropRule).not.toContain('rgba(22, 19, 15, 0.48)')
  })

  it('filters with fuzzy matching and opens the selected tab after closing first', async () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'GitHub', url: 'https://github.com/' }),
      createTab({ id: 2, index: 1, title: 'Android Developers', url: 'https://developer.android.com/' }),
    ]
    const { shadow, sendMessage } = await loadOverlay(tabs)
    const input = shadow.querySelector('input') as HTMLInputElement
    const overlayStateAtActivation: boolean[] = []
    sendMessage.mockImplementation(async (message: TabSearchMessage): Promise<TabSearchResponse> => {
      if (message.type === 'tab-search:get-tabs') return { ok: true, tabs }
      overlayStateAtActivation.push(document.getElementById(HOST_ID) !== null)
      return { ok: true }
    })

    input.value = 'gthb'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(shadow.querySelector('[role="option"] .tab-search__name')?.textContent).toBe('GitHub')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith({ type: 'tab-search:activate-tab', tabId: 1 }))
    expect(overlayStateAtActivation).toEqual([false])
    expect(document.getElementById(HOST_ID)).toBeNull()
  })

  it('supports arrow navigation and Escape close', async () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: '第一个', url: 'https://one.example' }),
      createTab({ id: 2, index: 1, title: '第二个', url: 'https://two.example', active: false }),
    ]
    const { shadow } = await loadOverlay(tabs)
    const input = shadow.querySelector('input') as HTMLInputElement

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(shadow.querySelectorAll('[role="option"]')[1]).toHaveAttribute('aria-selected', 'true')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.getElementById(HOST_ID)).toBeNull()
  })

  it('switches between tabs and browser history with Tab while preserving the query', async () => {
    const history = [createHistory({ title: 'GitHub 历史页面' })]
    const { shadow, sendMessage } = await loadOverlay([
      createTab({ title: 'GitHub 当前标签页' }),
    ], history)
    const input = shadow.querySelector('input') as HTMLInputElement

    input.value = 'GitHub'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(shadow.querySelector('[role="option"] .tab-search__name')?.textContent).toBe('GitHub 当前标签页')

    const toHistory = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    input.dispatchEvent(toHistory)
    expect(toHistory.defaultPrevented).toBe(true)
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith({ type: 'tab-search:get-history', query: 'GitHub' }))
    await waitFor(() => expect(shadow.querySelector('.tab-search__scope')?.textContent).toContain('浏览器历史记录'))
    expect(input.value).toBe('GitHub')
    expect(shadow.querySelector('[role="option"] .tab-search__name')?.textContent).toBe('GitHub 历史页面')
    expect(shadow.querySelector('.tab-search__time')?.textContent).toBe('5 分钟前')

    const backToTabs = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    input.dispatchEvent(backToTabs)
    expect(backToTabs.defaultPrevented).toBe(true)
    await waitFor(() => expect(shadow.querySelector('.tab-search__scope')?.textContent).toContain('当前浏览器窗口'))
    expect(input.value).toBe('GitHub')
    expect(shadow.querySelector('[role="option"] .tab-search__name')?.textContent).toBe('GitHub 当前标签页')
  })

  it('closes before opening a selected browser history item', async () => {
    const history = [createHistory({ url: 'https://history.example/open' })]
    const { shadow, sendMessage } = await loadOverlay([createTab()], history)
    const input = shadow.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await waitFor(() => expect(shadow.querySelector('[role="option"]')).toBeTruthy())

    const overlayStateAtOpen: boolean[] = []
    sendMessage.mockImplementation(async (message: TabSearchMessage): Promise<TabSearchResponse> => {
      if (message.type === 'tab-search:get-tabs') return { ok: true, tabs: [createTab()] }
      if (message.type === 'tab-search:get-history') return { ok: true, history }
      overlayStateAtOpen.push(document.getElementById(HOST_ID) !== null)
      return { ok: true }
    })

    const historyOption = shadow.querySelector('[role="option"]') as HTMLButtonElement
    historyOption.click()
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'tab-search:open-history',
      url: 'https://history.example/open',
    }))
    expect(overlayStateAtOpen).toEqual([false])
    expect(document.getElementById(HOST_ID)).toBeNull()
  })

  it('ignores an older history response after a newer query completes', async () => {
    const historyResponses: Array<(response: TabSearchResponse) => void> = []
    const tabs = [createTab()]
    const sendMessage = vi.fn((message: TabSearchMessage): Promise<TabSearchResponse> => {
      if (message.type === 'tab-search:get-tabs') return Promise.resolve({ ok: true, tabs })
      if (message.type === 'tab-search:get-history') {
        return new Promise((resolve) => historyResponses.push(resolve))
      }
      return Promise.resolve({ ok: true })
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const attachShadow = vi.spyOn(HTMLElement.prototype, 'attachShadow')
    await import('./content')

    const shadow = attachShadow.mock.results[0]?.value as ShadowRoot
    await waitFor(() => expect(shadow.querySelectorAll('[role="option"]')).toHaveLength(1))
    const input = shadow.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await waitFor(() => expect(historyResponses).toHaveLength(1))

    input.value = 'new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => expect(historyResponses).toHaveLength(2))

    historyResponses[1]({ ok: true, history: [createHistory({ title: 'new 结果' })] })
    await waitFor(() => expect(shadow.querySelector('.tab-search__name')?.textContent).toBe('new 结果'))
    historyResponses[0]({ ok: true, history: [createHistory({ title: 'old 结果' })] })
    await Promise.resolve()
    expect(shadow.querySelector('.tab-search__name')?.textContent).toBe('new 结果')
  })

  it('keeps the newest tab snapshot when refresh responses arrive out of order', async () => {
    const tabResponses: Array<(response: TabSearchResponse) => void> = []
    const sendMessage = vi.fn((message: TabSearchMessage): Promise<TabSearchResponse> => {
      if (message.type === 'tab-search:get-tabs') {
        return new Promise((resolve) => tabResponses.push(resolve))
      }
      return Promise.resolve({ ok: true })
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const attachShadow = vi.spyOn(HTMLElement.prototype, 'attachShadow')
    await import('./content')

    const host = document.getElementById(HOST_ID)
    const shadow = attachShadow.mock.results[0]?.value as ShadowRoot
    await waitFor(() => expect(tabResponses).toHaveLength(1))

    host!.dispatchEvent(new CustomEvent('linkdeck:refresh'))
    await waitFor(() => expect(tabResponses).toHaveLength(2))

    tabResponses[1]({ ok: true, tabs: [createTab({ title: '新标签页' })] })
    await waitFor(() => expect(shadow.querySelector('.tab-search__name')?.textContent).toBe('新标签页'))

    tabResponses[0]({ ok: true, tabs: [createTab({ title: '旧标签页' })] })
    await Promise.resolve()
    const input = shadow.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(shadow.querySelector('.tab-search__name')?.textContent).toBe('新标签页')
  })

  it('shows history errors and can return to the tab source', async () => {
    const tabs = [createTab({ title: '可用标签页' })]
    const sendMessage = vi.fn(async (message: TabSearchMessage): Promise<TabSearchResponse> => {
      if (message.type === 'tab-search:get-tabs') return { ok: true, tabs }
      if (message.type === 'tab-search:get-history') return { ok: false, error: '历史权限不可用' }
      return { ok: true }
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const attachShadow = vi.spyOn(HTMLElement.prototype, 'attachShadow')
    await import('./content')

    const shadow = attachShadow.mock.results[0]?.value as ShadowRoot
    await waitFor(() => expect(shadow.querySelectorAll('[role="option"]')).toHaveLength(1))
    const input = shadow.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await waitFor(() => expect(shadow.querySelector('.tab-search__empty strong')?.textContent).toBe('无法读取浏览器历史记录'))

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))
    await waitFor(() => expect(shadow.querySelector('.tab-search__name')?.textContent).toBe('可用标签页'))
  })

  it('refreshes an existing host instead of mounting a second overlay', async () => {
    const tabs = [createTab()]
    const { sendMessage } = await loadOverlay(tabs)
    const callsBeforeRepeat = sendMessage.mock.calls.length

    vi.resetModules()
    await import('./content')
    await waitFor(() => expect(sendMessage.mock.calls.length).toBeGreaterThan(callsBeforeRepeat))

    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1)
  })
})
