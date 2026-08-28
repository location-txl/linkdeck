import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '../types'
import {
  actionSetBadgeBackgroundColor,
  actionSetBadgeText,
  actionSetTitle,
  installChromeMock,
  setCurrentTab,
  tabsOnActivatedListeners,
  tabsOnUpdatedListeners,
  tabsQuery,
} from '../test/chrome'

describe('Gist service worker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('debounces LinkDeck storage changes and accepts popup messages', async () => {
    const baseChrome = installChromeMock()
    let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined
    let startupListener: (() => void) | undefined
    let installedListener: (() => void) | undefined
    let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined
    let contextMenuListener: ((info: { menuItemId: string; pageUrl?: string }, tab?: { title?: string; url?: string }) => void) | undefined
    const createContextMenu = vi.fn()
    const removeAllContextMenus = vi.fn((callback: () => void) => callback())
    vi.stubGlobal('chrome', {
      ...baseChrome,
      runtime: {
        onMessage: {
          addListener: (listener: typeof messageListener) => {
            messageListener = listener
          },
        },
        onStartup: {
          addListener: (listener: () => void) => {
            startupListener = listener
          },
        },
        onInstalled: {
          addListener: (listener: () => void) => {
            installedListener = listener
          },
        },
      },
      storage: {
        ...baseChrome.storage,
        onChanged: {
          addListener: (listener: typeof storageListener) => {
            storageListener = listener
          },
        },
      },
      contextMenus: {
        create: createContextMenu,
        removeAll: removeAllContextMenus,
        onClicked: {
          addListener: (listener: typeof contextMenuListener) => {
            contextMenuListener = listener
          },
        },
      },
    })

    const { bookmarkRepository } = await import('../lib/bookmark-repository')
    const createBookmark = vi.spyOn(bookmarkRepository, 'createBookmark').mockImplementation(async (draft) => ({
      bookmark: {
        id: 'context-menu-bookmark',
        tagIds: draft.tagIds,
        title: draft.title,
        url: draft.url,
        createdAt: 1,
        updatedAt: 1,
      },
      created: true,
      tagsMerged: false,
    }))
    const { gistSyncService } = await import('./gist-sync')
    const handle = vi.spyOn(gistSyncService, 'handle').mockResolvedValue({
      ok: true,
      state: { status: 'disconnected' },
    })
    await import('../service-worker')

    storageListener?.({ [STORAGE_KEYS.meta]: { newValue: {} } }, 'sync')
    await vi.advanceTimersByTimeAsync(500)
    expect(handle).toHaveBeenCalledWith({ type: 'gist-sync:sync-now' })

    storageListener?.({ [`${STORAGE_KEYS.tagPrefix}work`]: { newValue: {} } }, 'sync')
    await vi.advanceTimersByTimeAsync(500)
    expect(handle).toHaveBeenCalledTimes(2)

    storageListener?.({ 'unrelated:key': { newValue: {} } }, 'sync')
    await vi.advanceTimersByTimeAsync(500)
    expect(handle).toHaveBeenCalledTimes(2)

    startupListener?.()
    await Promise.resolve()
    expect(handle).toHaveBeenCalledTimes(3)

    handle.mockResolvedValueOnce({ ok: true, state: { status: 'syncing' } })
    installedListener?.()
    await Promise.resolve()
    expect(handle).toHaveBeenCalledTimes(4)
    expect(removeAllContextMenus).toHaveBeenCalledOnce()
    expect(createContextMenu).toHaveBeenCalledWith({
      id: 'linkdeck:save-current-page',
      title: '收藏当前页到 LinkDeck',
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    })

    contextMenuListener?.(
      { menuItemId: 'linkdeck:save-current-page', pageUrl: 'https://docs.example.com/guide' },
      { title: '示例文档' },
    )
    expect(createBookmark).toHaveBeenCalledWith({
      title: '示例文档',
      url: 'https://docs.example.com/guide',
      tagIds: [],
      newTagNames: [],
    })

    contextMenuListener?.(
      { menuItemId: 'linkdeck:save-current-page', pageUrl: 'https://example.com/long-title' },
      { title: 'a'.repeat(81) },
    )
    expect(createBookmark).toHaveBeenLastCalledWith({
      title: 'a'.repeat(80),
      url: 'https://example.com/long-title',
      tagIds: [],
      newTagNames: [],
    })

    await vi.advanceTimersByTimeAsync(3_000)
    expect(handle).toHaveBeenCalledTimes(5)
    expect(handle).toHaveBeenLastCalledWith({ type: 'gist-sync:sync-now' })

    const respond = vi.fn()
    expect(messageListener?.({ type: 'gist-sync:get-status' }, {}, respond)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(handle).toHaveBeenCalledWith({ type: 'gist-sync:get-status' })
    expect(respond).toHaveBeenCalledWith({ ok: true, state: { status: 'disconnected' } })
  })

  it('shows a saved badge for the active page and clears it for unsupported pages', async () => {
    installChromeMock()
    const { bookmarkRepository } = await import('../lib/bookmark-repository')
    vi.spyOn(bookmarkRepository, 'load').mockResolvedValue({
      meta: { schemaVersion: 2, tags: [] },
      bookmarks: [{
        id: 'saved',
        tagIds: [],
        title: 'Example',
        url: 'https://example.com/',
        createdAt: 1,
        updatedAt: 1,
      }],
    })
    await import('../service-worker')

    expect(actionSetBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#3f7d5f' })

    for (const listener of tabsOnActivatedListeners) listener({ tabId: 7, windowId: 1 })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(actionSetBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '✓' })
    expect(actionSetTitle).toHaveBeenCalledWith({ tabId: 7, title: 'LinkDeck · 已收藏' })

    setCurrentTab({ url: 'chrome://settings', active: true })
    for (const listener of tabsOnUpdatedListeners) listener(7, { url: 'chrome://settings' }, { active: true, url: 'chrome://settings' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(actionSetBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' })
    expect(actionSetTitle).toHaveBeenLastCalledWith({ tabId: 7, title: 'LinkDeck' })
  })

  it('refreshes active tab badges after LinkDeck storage changes but ignores unrelated changes', async () => {
    const chromeMock = installChromeMock()
    const { bookmarkRepository } = await import('../lib/bookmark-repository')
    vi.spyOn(bookmarkRepository, 'load').mockResolvedValue({
      meta: { schemaVersion: 2, tags: [] },
      bookmarks: [],
    })
    await import('../service-worker')

    await chromeMock.storage.sync.set({ [STORAGE_KEYS.meta]: { schemaVersion: 2, tags: [] } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(tabsQuery).toHaveBeenCalledWith({ active: true })
    const queryCount = tabsQuery.mock.calls.length

    await chromeMock.storage.sync.set({ 'unrelated:key': true })
    await Promise.resolve()
    await Promise.resolve()
    expect(tabsQuery).toHaveBeenCalledTimes(queryCount)
  })
})
