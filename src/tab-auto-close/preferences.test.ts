import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTO_CLOSE_DEFAULT_IDLE_MINUTES,
  getAutoCloseSession,
  getAutoCloseSettings,
  isWhitelistedHost,
  normalizeWhitelistDomain,
  setAutoCloseSession,
  setAutoCloseSettings,
} from './preferences'
import { STORAGE_KEYS } from '../types'
import { getLocalStore, installChromeMock } from '../test/chrome'

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
})
