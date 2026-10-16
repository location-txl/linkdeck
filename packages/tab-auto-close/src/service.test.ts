import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_CLOSE_ALARM_NAME,
  getAutoCloseHistory,
  getAutoCloseSession,
  setAutoCloseSettings,
} from './preferences'
import {
  checkAutoCloseTabs,
  ensureAutoCloseAlarm,
  handleAutoCloseStartup,
  handleAutoCloseStorageChange,
  registerAutoCloseService,
} from './service'
import {
  alarmsCreate,
  alarmsGet,
  installChromeMock,
  setTabs,
  tabsRemove,
  tabsOnUpdatedListeners,
} from '@linkdeck/test-utils'

describe('auto-close service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installChromeMock()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('initializes background tabs, closes only timed-out pages, and protects active or whitelisted pages', async () => {
    setTabs([
      { id: 1, windowId: 1, active: true, url: 'https://active.example.com' },
      { id: 2, windowId: 1, active: false, url: 'https://docs.example.com' },
      { id: 3, windowId: 2, active: false, pinned: true, url: 'https://pinned.example.com' },
      { id: 4, windowId: 2, active: false, audible: true, url: 'https://music.example.com' },
      { id: 5, windowId: 2, active: false, url: 'https://otherexample.com' },
      { id: 6, windowId: 2, active: false, url: 'chrome://settings' },
    ])
    await setAutoCloseSettings({ enabled: true, idleMinutes: 1, whitelistDomains: ['example.com'] })

    await checkAutoCloseTabs(1_000)
    expect(tabsRemove).not.toHaveBeenCalled()
    await checkAutoCloseTabs(61_001)

    expect(tabsRemove).toHaveBeenCalledTimes(1)
    expect(tabsRemove).toHaveBeenCalledWith(5)
  })

  it('restarts all timers after a long scheduling gap and retries a failed close later', async () => {
    setTabs([{ id: 9, windowId: 1, active: false, url: 'https://example.com' }])
    await setAutoCloseSettings({ enabled: true, idleMinutes: 1, whitelistDomains: [] })

    await checkAutoCloseTabs(1_000)
    await checkAutoCloseTabs(301_001)
    expect(tabsRemove).not.toHaveBeenCalled()

    tabsRemove.mockRejectedValueOnce(new Error('tab changed'))
    await checkAutoCloseTabs(361_001)
    expect(tabsRemove).toHaveBeenCalledWith(9)
    await checkAutoCloseTabs(421_001)
    expect(tabsRemove).toHaveBeenCalledTimes(2)
  })

  it('starts a background timer when a tab is left and resets affected pages when the whitelist changes', async () => {
    setTabs([
      { id: 11, windowId: 1, active: true, url: 'https://active.example.com' },
      { id: 12, windowId: 1, active: false, url: 'https://docs.example.com' },
    ])
    const initialSettings = { enabled: true, idleMinutes: 1, whitelistDomains: [] }
    await setAutoCloseSettings(initialSettings)
    await checkAutoCloseTabs(1_000)

    setTabs([
      { id: 11, windowId: 1, active: false, url: 'https://active.example.com' },
      { id: 12, windowId: 1, active: true, url: 'https://docs.example.com' },
    ])
    await checkAutoCloseTabs(2_000)
    await checkAutoCloseTabs(62_001)
    expect(tabsRemove).toHaveBeenCalledWith(11)

    setTabs([{ id: 13, windowId: 1, active: false, url: 'https://keep.example.com' }])
    await setAutoCloseSettings(initialSettings)
    await checkAutoCloseTabs(100_000)
    const whitelistedSettings = { enabled: true, idleMinutes: 1, whitelistDomains: ['example.com'] }
    await setAutoCloseSettings(whitelistedSettings)
    await handleAutoCloseStorageChange({ oldValue: initialSettings, newValue: whitelistedSettings }, 'local')
    expect((await getAutoCloseSession()).idleSince).toEqual({})

    const removedWhitelistSettings = { enabled: true, idleMinutes: 1, whitelistDomains: [] }
    await setAutoCloseSettings(removedWhitelistSettings)
    await handleAutoCloseStorageChange({ oldValue: whitelistedSettings, newValue: removedWhitelistSettings }, 'local')
    expect((await getAutoCloseSession()).idleSince).toEqual({ '13': expect.any(Number) })
  })

  it.each(['navigation', 'whitelist'])('preserves sleep detection after a %s update', async (event) => {
    setTabs([
      { id: 1, active: false, url: 'https://a.example.com' },
      { id: 2, active: false, url: 'https://b.example.com' },
    ])
    const settings = { enabled: true, idleMinutes: 1, whitelistDomains: [] }
    await setAutoCloseSettings(settings)
    await checkAutoCloseTabs(1_000)
    vi.setSystemTime(601_000)

    if (event === 'navigation') {
      registerAutoCloseService()
      tabsOnUpdatedListeners.forEach((listener) => listener(1, { url: 'https://a.example.com/new' }, {}))
    } else {
      const next = { ...settings, whitelistDomains: ['a.example.com'] }
      await setAutoCloseSettings(next)
      await handleAutoCloseStorageChange({ oldValue: settings, newValue: next }, 'local')
    }

    await checkAutoCloseTabs(601_001)
    expect(tabsRemove).not.toHaveBeenCalled()
    expect((await getAutoCloseSession()).idleSince['2']).toBe(601_001)
    await checkAutoCloseTabs(661_001)
    expect(tabsRemove).toHaveBeenCalledWith(2)
  })

  it('records closed tabs in the close history and skips failed closes', async () => {
    setTabs([{ id: 21, windowId: 1, active: false, url: 'https://docs.example.com/guide', title: '使用指南' }])
    await setAutoCloseSettings({ enabled: true, idleMinutes: 1, whitelistDomains: [] })

    await checkAutoCloseTabs(1_000)
    tabsRemove.mockRejectedValueOnce(new Error('tab changed'))
    await checkAutoCloseTabs(61_001)
    await expect(getAutoCloseHistory()).resolves.toEqual([])

    await checkAutoCloseTabs(121_001)
    await expect(getAutoCloseHistory()).resolves.toEqual([
      { url: 'https://docs.example.com/guide', title: '使用指南', closedAt: 121_001 },
    ])
  })

  it('clears session timers on browser startup so resumed pages get a fresh baseline', async () => {
    setTabs([{ id: 14, windowId: 1, active: false, url: 'https://example.com' }])
    await setAutoCloseSettings({ enabled: true, idleMinutes: 1, whitelistDomains: [] })
    await checkAutoCloseTabs(1_000)
    expect((await getAutoCloseSession()).lastCheckAt).toBe(1_000)

    await handleAutoCloseStartup()
    expect(await getAutoCloseSession()).toEqual({ idleSince: {} })
  })

  it('creates the named minute alarm only when the feature is enabled', async () => {
    await ensureAutoCloseAlarm()
    expect(alarmsCreate).not.toHaveBeenCalled()

    await setAutoCloseSettings({ enabled: true, idleMinutes: 120, whitelistDomains: [] })
    await ensureAutoCloseAlarm()
    expect(alarmsGet).toHaveBeenLastCalledWith(AUTO_CLOSE_ALARM_NAME)
    expect(alarmsCreate).toHaveBeenCalledWith(AUTO_CLOSE_ALARM_NAME, { periodInMinutes: 1 })
  })
})
