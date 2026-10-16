import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installChromeMock,
  permissionsOnRemovedListeners,
  scriptingExecuteScript,
  scriptingGetRegisteredContentScripts,
  scriptingRegisterContentScripts,
  scriptingUnregisterContentScripts,
  setTabs,
  tabsSendMessage,
} from '@linkdeck/test-utils'
import { STORAGE_KEYS } from './types'
import { SAME_TAB_GET_RULE, SAME_TAB_REFRESH } from './messages'
import { siteOrigins } from './rules'

describe('导航后台和权限生命周期', () => {
  beforeEach(() => { installChromeMock(); vi.resetModules(); setTabs([{ id: 1, url: 'https://scys.com/' }, { id: 2, url: 'https://feishu.cn/' }]) })
  const configure = async () => {
    await chrome.permissions.request({ origins: siteOrigins('scys.com') })
    await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: { enabled: true, sites: [{ domain: 'scys.com', scope: 'all' }] } })
    return import('./service')
  }

  it('registers persistent scripts in both worlds only for authorized configured sites', async () => {
    const service = await configure()
    await service.syncSameTabNavigation()
    expect(scriptingRegisterContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true, matches: siteOrigins('scys.com') }),
      expect.objectContaining({ world: 'ISOLATED', runAt: 'document_start', persistAcrossSessions: true, matches: siteOrigins('scys.com') }),
    ])
    expect(scriptingExecuteScript).toHaveBeenCalledTimes(2)
    expect(scriptingExecuteScript.mock.calls.every(([input]) => input.target.tabId === 1)).toBe(true)
    await service.syncSameTabNavigation()
    expect(scriptingRegisterContentScripts).toHaveBeenCalledTimes(1)
    expect(scriptingGetRegisteredContentScripts).toHaveBeenCalledTimes(2)
  })

  it('disables already open pages and unregisters after disabling or deleting the rule', async () => {
    const service = await configure()
    await service.syncSameTabNavigation()
    scriptingExecuteScript.mockClear()
    await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: { enabled: false, sites: [{ domain: 'scys.com', scope: 'all' }] } })
    await service.syncSameTabNavigation()
    expect(scriptingUnregisterContentScripts).toHaveBeenCalled()
    expect(tabsSendMessage).toHaveBeenCalledWith(1, { type: 'same-tab-navigation:update' })
    expect(scriptingExecuteScript).not.toHaveBeenCalled()
    expect(await service.getEffectiveSiteRule('https://scys.com/')).toBeNull()
  })

  it('reconciles revoked permissions and resumes stored rules on service startup', async () => {
    const service = await configure()
    service.registerSameTabNavigationService()
    await service.syncSameTabNavigation()
    expect(await service.getEffectiveSiteRule('https://scys.com/')).not.toBeNull()
    await chrome.permissions.remove({ origins: siteOrigins('scys.com') })
    expect(permissionsOnRemovedListeners.size).toBe(1)
    await service.syncSameTabNavigation()
    expect(await service.getEffectiveSiteRule('https://scys.com/')).toBeNull()
    expect(scriptingUnregisterContentScripts).toHaveBeenCalled()
  })

  it('validates browser-supplied source and only lets extension UI refresh registrations', async () => {
    const service = await configure()
    expect(await service.handleSameTabMessage({ type: SAME_TAB_GET_RULE }, { tab: { id: 1 } as chrome.tabs.Tab, frameId: 0, url: 'https://scys.com/' }))
      .toEqual({ ok: true, rule: { domain: 'scys.com', scope: 'all' } })
    expect(await service.handleSameTabMessage({ type: SAME_TAB_GET_RULE }, { tab: { id: 1 } as chrome.tabs.Tab, frameId: 1, url: 'https://scys.com/' })).toEqual({ ok: true, rule: null })
    expect(await service.handleSameTabMessage({ type: SAME_TAB_REFRESH }, { tab: { id: 1 } as chrome.tabs.Tab })).toMatchObject({ ok: false })
    expect(await service.handleSameTabMessage({ type: SAME_TAB_REFRESH }, {})).toEqual({ ok: true })
    expect(await service.getEffectiveSiteRule('chrome://settings')).toBeNull()
  })

  it('returns registration errors for the settings UI instead of claiming success', async () => {
    const service = await configure()
    scriptingRegisterContentScripts.mockRejectedValueOnce(new Error('registration failed'))
    expect(await service.handleSameTabMessage({ type: SAME_TAB_REFRESH }, {})).toEqual({ ok: false, error: 'registration failed' })
    expect(await service.handleSameTabMessage({ type: SAME_TAB_REFRESH }, {})).toEqual({ ok: true })
  })

  it('replaces persisted older script registrations even when their match patterns are unchanged', async () => {
    const service = await configure()
    await chrome.scripting.registerContentScripts([
      { id: 'linkdeck-same-tab-main-v2', js: ['assets/same-tab-main.js'], matches: siteOrigins('scys.com'), world: 'MAIN' },
      { id: 'linkdeck-same-tab-bridge-v2', js: ['assets/same-tab-content.js'], matches: siteOrigins('scys.com'), world: 'ISOLATED' },
      { id: 'another-feature', js: ['another.js'], matches: ['https://example.com/*'] },
    ])
    await service.syncSameTabNavigation()
    const registered = await chrome.scripting.getRegisteredContentScripts()
    expect(registered.filter((script) => script.id.startsWith('linkdeck-same-tab-'))).toHaveLength(2)
    expect(registered.filter((script) => script.id.startsWith('linkdeck-same-tab-')).every((script) => script.id.endsWith('-v3'))).toBe(true)
    expect(registered.some((script) => script.id === 'another-feature')).toBe(true)
    expect(scriptingUnregisterContentScripts).toHaveBeenCalledWith({ ids: ['linkdeck-same-tab-main-v2', 'linkdeck-same-tab-bridge-v2'] })
  })
})
