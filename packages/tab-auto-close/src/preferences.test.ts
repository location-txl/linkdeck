import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTO_CLOSE_DEFAULT_IDLE_MINUTES,
  AUTO_CLOSE_HISTORY_LIMIT,
  appendAutoCloseHistory,
  clearAutoCloseHistory,
  getAutoCloseHistory,
  getAutoCloseSession,
  getAutoCloseSettings,
  isWhitelistedHost,
  normalizeWhitelistDomain,
  setAutoCloseSession,
  setAutoCloseSettings,
} from './preferences'
import { STORAGE_KEYS } from './types'
import { MAX_BOOKMARK_TITLE_LENGTH, MAX_URL_LENGTH } from '@linkdeck/shared'
import { getLocalStore, installChromeMock } from '@linkdeck/test-utils'

describe('auto-close preferences', () => {
  beforeEach(() => {
    installChromeMock()
  })

  it('uses a disabled 120-minute default and stores settings locally', async () => {
    await expect(getAutoCloseSettings()).resolves.toEqual({
      enabled: false,
      idleMinutes: AUTO_CLOSE_DEFAULT_IDLE_MINUTES,
      whitelistDomains: [],
    })

    await setAutoCloseSettings({ enabled: true, idleMinutes: 45, whitelistDomains: ['Example.com', 'https://docs.example.com/path'] })

    expect(getLocalStore()[STORAGE_KEYS.autoCloseSettings]).toEqual({
      enabled: true,
      idleMinutes: 45,
      whitelistDomains: ['example.com', 'docs.example.com'],
    })
    await expect(getAutoCloseSettings()).resolves.toEqual({
      enabled: true,
      idleMinutes: 45,
      whitelistDomains: ['example.com', 'docs.example.com'],
    })
  })

  it('normalizes URL input and keeps domain suffix matching bounded', () => {
    expect(normalizeWhitelistDomain(' HTTPS://Example.COM/docs?q=1 ')).toBe('example.com')
    expect(normalizeWhitelistDomain('')).toBeUndefined()
    expect(normalizeWhitelistDomain('chrome://settings')).toBeUndefined()
    expect(isWhitelistedHost('docs.example.com', ['example.com'])).toBe(true)
    expect(isWhitelistedHost('example.com', ['example.com'])).toBe(true)
    expect(isWhitelistedHost('otherexample.com', ['example.com'])).toBe(false)
  })

  it('rejects invalid durations and keeps session data out of local storage', async () => {
    await expect(setAutoCloseSettings({ enabled: true, idleMinutes: 0, whitelistDomains: [] })).rejects.toThrow('整数分钟')
    await setAutoCloseSession({ lastCheckAt: 1_000, idleSince: { '7': 2_000 } })
    await expect(getAutoCloseSession()).resolves.toEqual({ lastCheckAt: 1_000, idleSince: { '7': 2_000 } })
    expect(getLocalStore()[STORAGE_KEYS.autoCloseSession]).toBeUndefined()
  })

  it('records auto-close history newest first and clears it on demand', async () => {
    await appendAutoCloseHistory({ url: 'https://a.example.com', title: '页面 A', closedAt: 1_000 })
    await appendAutoCloseHistory({ url: 'https://b.example.com', title: '  页面 B  ', closedAt: 2_000 })

    await expect(getAutoCloseHistory()).resolves.toEqual([
      { url: 'https://b.example.com', title: '页面 B', closedAt: 2_000 },
      { url: 'https://a.example.com', title: '页面 A', closedAt: 1_000 },
    ])

    await clearAutoCloseHistory()
    await expect(getAutoCloseHistory()).resolves.toEqual([])
    expect(getLocalStore()[STORAGE_KEYS.autoCloseHistory]).toBeUndefined()
  })

  it('drops invalid stored history entries and trims titles to the bookmark limit', async () => {
    const longTitle = '长'.repeat(MAX_BOOKMARK_TITLE_LENGTH + 10)
    await chrome.storage.local.set({
      [STORAGE_KEYS.autoCloseHistory]: [
        { url: 'https://ok.example.com', title: `  ${longTitle}  `, closedAt: 5_000 },
        { url: 'chrome://settings', title: '内置页', closedAt: 6_000 },
        { url: 'https://missing.example.com', title: '缺时间' },
        'not-an-entry',
        { url: `https://long.example.com/${'x'.repeat(MAX_URL_LENGTH)}`, title: '超长网址', closedAt: 7_000 },
      ],
    })

    await expect(getAutoCloseHistory()).resolves.toEqual([
      { url: 'https://ok.example.com', title: '长'.repeat(MAX_BOOKMARK_TITLE_LENGTH), closedAt: 5_000 },
    ])
  })

  it('keeps only the newest entries when history exceeds the retention limit', async () => {
    const seeded = Array.from({ length: AUTO_CLOSE_HISTORY_LIMIT }, (_, index) => ({
      url: `https://batch-${index}.example.com`,
      title: `批量 ${index}`,
      closedAt: index + 1,
    }))
    await chrome.storage.local.set({ [STORAGE_KEYS.autoCloseHistory]: [...seeded].reverse() })

    await appendAutoCloseHistory({ url: 'https://newest.example.com', title: '最新', closedAt: AUTO_CLOSE_HISTORY_LIMIT + 1 })

    const history = await getAutoCloseHistory()
    expect(history).toHaveLength(AUTO_CLOSE_HISTORY_LIMIT)
    expect(history[0]).toEqual({ url: 'https://newest.example.com', title: '最新', closedAt: AUTO_CLOSE_HISTORY_LIMIT + 1 })
    expect(history[1]).toEqual(seeded[seeded.length - 1])
    expect(history.some((entry) => entry.url === 'https://batch-0.example.com')).toBe(false)
  })
})
