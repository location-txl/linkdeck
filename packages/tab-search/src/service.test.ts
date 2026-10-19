import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { historySearch, installChromeMock, tabsCreate, tabsGet, tabsQuery, tabsUpdate } from '@linkdeck/test-utils'
import { handleTabSearchMessage } from './service'

describe('tab search service', () => {
  beforeEach(() => installChromeMock())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns only the sender window tabs in browser order', async () => {
    tabsQuery.mockResolvedValue([
      { id: 9, index: 1, windowId: 7, title: '第二个', url: 'https://second.example', active: false, pinned: false },
      { id: 8, index: 0, windowId: 7, title: '第一个', url: 'https://first.example', active: true, pinned: true, favIconUrl: 'https://first.example/icon.png' },
      { id: 10, index: 0, windowId: 8, title: '其他窗口', url: 'https://other.example', active: true, pinned: false },
    ])

    const response = await handleTabSearchMessage(
      { type: 'tab-search:get-tabs' },
      { tab: { id: 8, windowId: 7 } } as chrome.runtime.MessageSender,
    )

    expect(tabsQuery).toHaveBeenCalledWith({ windowId: 7 })
    expect(response).toEqual({
      ok: true,
      tabs: [
        { id: 8, index: 0, title: '第一个', url: 'https://first.example', favIconUrl: 'https://first.example/icon.png', active: true, pinned: true },
        { id: 9, index: 1, title: '第二个', url: 'https://second.example', active: false, pinned: false },
      ],
    })
  })

  it('queries browser history with a trimmed query and normalizes display fields', async () => {
    historySearch.mockResolvedValue([
      { id: 'history-1', title: '  ', url: ' https://example.com/guide ', lastVisitTime: 123 },
      { id: 'history-2', title: '无网址' },
    ])

    const response = await handleTabSearchMessage(
      { type: 'tab-search:get-history', query: '  guide  ' },
      { tab: { id: 8, windowId: 7 } } as chrome.runtime.MessageSender,
    )

    expect(historySearch).toHaveBeenCalledWith({
      text: 'guide',
      startTime: expect.any(Number),
      maxResults: 100,
    })
    const [historyQuery] = historySearch.mock.calls[0] as [{ startTime: number }]
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    expect(historyQuery.startTime).toBeGreaterThan(Date.now() - sevenDaysMs - 1_000)
    expect(historyQuery.startTime).toBeLessThanOrEqual(Date.now() - sevenDaysMs)
    expect(response).toEqual({
      ok: true,
      history: [{
        id: 'history-1',
        title: '未命名页面',
        url: 'https://example.com/guide',
        lastVisitTime: 123,
      }],
    })
  })

  it('returns a clear error when browser history cannot be read', async () => {
    historySearch.mockRejectedValue(new Error('history permission denied'))

    await expect(handleTabSearchMessage(
      { type: 'tab-search:get-history', query: '' },
      { tab: { id: 8, windowId: 7 } } as chrome.runtime.MessageSender,
    )).resolves.toEqual({ ok: false, error: '读取浏览器历史记录失败，请重新尝试。' })
  })

  it('activates a target in the sender window and rejects another window', async () => {
    tabsGet.mockResolvedValue({ id: 9, windowId: 7 } as chrome.tabs.Tab)
    const sender = { tab: { id: 8, windowId: 7 } } as chrome.runtime.MessageSender

    await expect(handleTabSearchMessage({ type: 'tab-search:activate-tab', tabId: 9 }, sender))
      .resolves.toEqual({ ok: true })
    expect(tabsUpdate).toHaveBeenCalledWith(9, { active: true })

    tabsGet.mockResolvedValue({ id: 10, windowId: 8 } as chrome.tabs.Tab)
    await expect(handleTabSearchMessage({ type: 'tab-search:activate-tab', tabId: 10 }, sender))
      .resolves.toEqual({ ok: false, error: '不能切换其他窗口的标签页。' })
    expect(tabsUpdate).toHaveBeenCalledTimes(1)
  })

  it('activates an already open history URL in the sender window', async () => {
    tabsQuery.mockResolvedValue([
      { id: 21, windowId: 7, url: 'https://example.com/existing' },
      { id: 22, windowId: 7, url: 'https://example.com/other' },
    ])

    await expect(handleTabSearchMessage(
      { type: 'tab-search:open-history', url: 'https://example.com/existing' },
      { tab: { id: 8, windowId: 7 } } as chrome.runtime.MessageSender,
    )).resolves.toEqual({ ok: true })

    expect(tabsQuery).toHaveBeenCalledWith({ windowId: 7 })
    expect(tabsUpdate).toHaveBeenCalledWith(21, { active: true })
    expect(tabsCreate).not.toHaveBeenCalled()
  })

  it('opens a missing history URL in the sender window', async () => {
    tabsQuery.mockResolvedValue([{ id: 21, windowId: 7, url: 'https://example.com/other' }])

    await expect(handleTabSearchMessage(
      { type: 'tab-search:open-history', url: ' https://example.com/new ' },
      { tab: { id: 8, windowId: 7 } } as chrome.runtime.MessageSender,
    )).resolves.toEqual({ ok: true })

    expect(tabsCreate).toHaveBeenCalledWith({
      windowId: 7,
      url: 'https://example.com/new',
      active: true,
    })
  })

  it('returns a clear error when the sender has no browser window', async () => {
    const response = await handleTabSearchMessage(
      { type: 'tab-search:get-tabs' },
      {} as chrome.runtime.MessageSender,
    )

    expect(response).toEqual({ ok: false, error: '无法确定当前浏览器窗口。' })
    expect(tabsQuery).not.toHaveBeenCalled()
  })
})
