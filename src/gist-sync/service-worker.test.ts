import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '../types'
import { installChromeMock } from '../test/chrome'

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
    let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void) | undefined
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
      },
      storage: {
        ...baseChrome.storage,
        onChanged: {
          addListener: (listener: typeof storageListener) => {
            storageListener = listener
          },
        },
      },
    })

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

    const respond = vi.fn()
    expect(messageListener?.({ type: 'gist-sync:get-status' }, {}, respond)).toBe(true)
    await Promise.resolve()
    expect(handle).toHaveBeenCalledWith({ type: 'gist-sync:get-status' })
    expect(respond).toHaveBeenCalledWith({ ok: true, state: { status: 'disconnected' } })
  })
})
