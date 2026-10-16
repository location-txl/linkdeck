import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock, runtimeSendMessage } from '@linkdeck/test-utils'
import { STORAGE_KEYS } from './types'
import { SAME_TAB_CONFIG_EVENT } from './messages'

describe('页面配置桥接', () => {
  beforeEach(() => { installChromeMock(); vi.resetModules() })
  afterEach(() => {
    const host = window as Window & { __linkdeckSameTabBridgeCleanup?: () => void }
    host.__linkdeckSameTabBridgeCleanup?.()
    delete host.__linkdeckSameTabBridgeCleanup
    vi.restoreAllMocks()
  })

  it('publishes the effective rule and replaces listeners on reinjection', async () => {
    runtimeSendMessage.mockResolvedValue({ ok: true, rule: { domain: 'scys.com', scope: 'all' } })
    const configs: unknown[] = []
    const listener = (event: Event) => configs.push((event as CustomEvent).detail)
    window.addEventListener(SAME_TAB_CONFIG_EVENT, listener)
    try {
      await import('./content')
      await vi.waitFor(() => expect(configs).toContainEqual({ domain: 'scys.com', scope: 'all' }))
      vi.resetModules()
      await import('./content')
      runtimeSendMessage.mockClear()
      runtimeSendMessage.mockResolvedValue({ ok: true, rule: null })
      await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: { enabled: false, sites: [] } })
      expect(configs.at(-1)).toBeNull()
      await vi.waitFor(() => expect(runtimeSendMessage).toHaveBeenCalledTimes(1))
    } finally { window.removeEventListener(SAME_TAB_CONFIG_EVENT, listener) }
  })

  it('ignores a stale active response after a newer disable response', async () => {
    let finishOld: (value: unknown) => void = () => undefined
    runtimeSendMessage.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    const configs: unknown[] = []
    const listener = (event: Event) => configs.push((event as CustomEvent).detail)
    window.addEventListener(SAME_TAB_CONFIG_EVENT, listener)
    try {
      await import('./content')
      await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: { enabled: false, sites: [] } })
      await vi.waitFor(() => expect(configs.at(-1)).toBeNull())
      finishOld({ ok: true, rule: { domain: 'scys.com', scope: 'all' } })
      await Promise.resolve()
      expect(configs.every((config) => config === null)).toBe(true)
    } finally { window.removeEventListener(SAME_TAB_CONFIG_EVENT, listener) }
  })
})
