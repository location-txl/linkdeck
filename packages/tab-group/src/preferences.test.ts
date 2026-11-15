import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalStore, installChromeMock } from '@linkdeck/test-utils'
import { STORAGE_KEYS } from './types'
import { getTabGroupSettings, normalizeTabGroupSettings, setTabGroupSettings } from './preferences'

describe('tab group preferences', () => {
  beforeEach(() => { installChromeMock() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('normalizes any stored value to a safe switch', () => {
    expect(normalizeTabGroupSettings(undefined)).toEqual({ enabled: false })
    expect(normalizeTabGroupSettings('invalid')).toEqual({ enabled: false })
    expect(normalizeTabGroupSettings({ enabled: 'yes' })).toEqual({ enabled: false })
    expect(normalizeTabGroupSettings({ enabled: true })).toEqual({ enabled: true })
  })

  it('round-trips settings through local storage only', async () => {
    await setTabGroupSettings({ enabled: true })
    expect(getLocalStore()[STORAGE_KEYS.tabGroupSettings]).toEqual({ enabled: true })
    expect(await getTabGroupSettings()).toEqual({ enabled: true })
  })

  it('falls back to window localStorage outside the extension runtime', async () => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    await setTabGroupSettings({ enabled: true })
    expect(await getTabGroupSettings()).toEqual({ enabled: true })
  })
})
