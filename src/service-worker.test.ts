import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runtimeOnMessageListeners,
  runtimeOnStartupListeners,
  runtimeOnInstalledListeners,
  storageOnChangedListeners,
  alarmsOnAlarmListeners,
  tabsOnCreatedListeners,
  tabsOnRemovedListeners,
  permissionsOnAddedListeners,
  permissionsOnRemovedListeners,
  tabsGet,
} from '@linkdeck/test-utils'
import { STORAGE_KEYS } from '@linkdeck/bookmarks'
import {
  actionSetBadgeBackgroundColor,
  actionSetBadgeText,
  actionSetTitle,
  commandsOnCommandListeners,
  installChromeMock,
  setCurrentTab,
  scriptingExecuteScript,
  tabsOnActivatedListeners,
  tabsOnUpdatedListeners,
  tabsQuery,
} from '@linkdeck/test-utils'

describe('extension service worker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('debounces LinkDeck storage changes and accepts popup messages', async () => {
    const chromeMock = installChromeMock()
    const createContextMenu = chromeMock.contextMenus.create
    const removeAllContextMenus = chromeMock.contextMenus.removeAll
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      for (const listener of storageOnChangedListeners) listener(changes, areaName)
    }
    const startupListener = () => { for (const listener of runtimeOnStartupListeners) listener() }
    const installedListener = () => { for (const listener of runtimeOnInstalledListeners) listener() }
    const messageListener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => {
      return [...runtimeOnMessageListeners].some((listener) => listener(message, sender, respond) === true)
    }
    const contextMenuListener = (info: { menuItemId: string; pageUrl?: string }, tab?: { title?: string; url?: string }) => {
      const listener = chromeMock.contextMenus.onClicked.addListener.mock.calls[0]?.[0] as (info: unknown, tab: unknown) => void
      listener(info, tab)
    }

    const { bookmarkRepository } = await import('@linkdeck/bookmarks/repository')
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
    const { gistSyncService } = await import('@linkdeck/gist-sync/service')
    const handle = vi.spyOn(gistSyncService, 'handle').mockResolvedValue({
      ok: true,
      state: { status: 'disconnected' },
    })
    await import('./service-worker')

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
    const { bookmarkRepository } = await import('@linkdeck/bookmarks/repository')
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
    await import('./service-worker')

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
    const { bookmarkRepository } = await import('@linkdeck/bookmarks/repository')
    vi.spyOn(bookmarkRepository, 'load').mockResolvedValue({
      meta: { schemaVersion: 2, tags: [] },
      bookmarks: [],
    })
    await import('./service-worker')

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

  it('registers the tab search command at module load and injects one fixed bundle', async () => {
    installChromeMock()
    await import('./service-worker')

    expect(commandsOnCommandListeners).toHaveLength(1)
    for (const listener of commandsOnCommandListeners) listener('unrelated-command', { id: 4, windowId: 2 })
    expect(scriptingExecuteScript).not.toHaveBeenCalled()

    for (const listener of commandsOnCommandListeners) listener('open-tab-search', { id: 4, windowId: 2 })
    await Promise.resolve()
    expect(scriptingExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 4 },
      files: ['assets/tab-search-overlay.js'],
    })

    scriptingExecuteScript.mockRejectedValueOnce(new Error('protected page'))
    for (const listener of commandsOnCommandListeners) listener('open-tab-search', { id: 4, windowId: 2 })
    await Promise.resolve()
    expect(scriptingExecuteScript).toHaveBeenCalledTimes(2)
  })
  it('routes each feature message to exactly one asynchronous responder', async () => {
    installChromeMock()
    await import('./service-worker')
    expect(runtimeOnMessageListeners).toHaveLength(3)

    const cases = [
      { message: { type: 'gist-sync:get-status' }, expected: { ok: true, state: { status: 'disconnected' } } },
      { message: { type: 'tab-search:get-tabs' }, expected: undefined },
      { message: { type: 'same-tab-navigation:get-rule' }, expected: { ok: true, rule: null } },
    ]
    for (const { message, expected } of cases) {
      const respond = vi.fn()
      const accepted = [...runtimeOnMessageListeners].filter((listener) => listener(message, {}, respond) === true)
      expect(accepted).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(respond).toHaveBeenCalledOnce()
      if (expected) expect(respond).toHaveBeenCalledWith(expected)
    }

    const respond = vi.fn()
    for (const listener of runtimeOnMessageListeners) expect(listener({ type: 'unrelated' }, {}, respond)).toBeUndefined()
    expect(respond).not.toHaveBeenCalled()
  })

  it('registers each feature once when the worker module is imported again', async () => {
    installChromeMock()
    await import('./service-worker')
    await import('./service-worker')

    expect(runtimeOnMessageListeners).toHaveLength(3)
    expect(runtimeOnStartupListeners).toHaveLength(4)
    expect(runtimeOnInstalledListeners).toHaveLength(4)
    expect(storageOnChangedListeners).toHaveLength(4)
    expect(commandsOnCommandListeners).toHaveLength(1)
    expect(alarmsOnAlarmListeners).toHaveLength(1)
    expect(tabsOnActivatedListeners).toHaveLength(2)
    expect(tabsOnUpdatedListeners).toHaveLength(2)
    expect(tabsOnCreatedListeners).toHaveLength(1)
    expect(tabsOnRemovedListeners).toHaveLength(1)
    expect(permissionsOnAddedListeners).toHaveLength(1)
    expect(permissionsOnRemovedListeners).toHaveLength(1)
    expect(tabsGet).not.toHaveBeenCalled()
  })

})
