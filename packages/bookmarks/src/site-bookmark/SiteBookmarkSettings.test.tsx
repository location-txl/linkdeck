import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getLocalStore, installChromeMock, permissionsGetAll, permissionsRequest, scriptingExecuteScript, setCurrentTab } from '@linkdeck/test-utils'
import { SiteBookmarkSettingsPanel } from './SiteBookmarkSettings'
import { siteOrigins } from './rules'
import { SITE_BOOKMARK_KEY, type SiteRule } from './types'
import { X_BOOKMARK_KEY } from '../x-bookmark/messages'

const rule: SiteRule = {
  id: 'rule-1', domain: 'github.com', name: 'GitHub', enabled: true,
  triggerSelector: 'button[data-testid="star"]',
  url: { source: { kind: 'pageUrl' } }, title: { source: { kind: 'pageTitle' } },
  tagName: 'GitHub', createdAt: 1, updatedAt: 1,
}
const storeRules = async (rules: SiteRule[], enabled = true) => {
  await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled, rules } })
}

beforeEach(() => {
  installChromeMock()
  setCurrentTab({ id: 7, url: 'https://github.com/owner/repo' })
  vi.spyOn(chrome.runtime, 'getManifest').mockReturnValue({ manifest_version: 3, name: 'LinkDeck', version: '1.1.0', host_permissions: ['https://api.github.com/*'] } as chrome.runtime.ManifestV3)
  vi.spyOn(window, 'close').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('站点收藏规则设置', () => {
  it('creates a rule for the current site by granting access and launching the picker', async () => {
    const user = userEvent.setup()
    render(<SiteBookmarkSettingsPanel />)
    const add = await screen.findByRole('button', { name: '为当前网站 github.com 创建规则' })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: siteOrigins('github.com') })
    expect(scriptingExecuteScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ['assets/site-bookmark-picker.js'] })
    expect(window.close).toHaveBeenCalled()
  })

  it('does not inject the picker when access is denied', async () => {
    permissionsRequest.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    render(<SiteBookmarkSettingsPanel />)
    const add = await screen.findByRole('button', { name: '为当前网站 github.com 创建规则' })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    expect(await screen.findByRole('alert')).toHaveTextContent('未获得网站权限')
    expect(scriptingExecuteScript).not.toHaveBeenCalled()
    expect(window.close).not.toHaveBeenCalled()
  })

  it('toggles the master switch and per-rule switch with local storage only', async () => {
    await storeRules([rule])
    const user = userEvent.setup()
    render(<SiteBookmarkSettingsPanel />)
    const master = await screen.findByRole('checkbox', { name: /启用站点收藏规则/ })
    await waitFor(() => expect(master).toBeEnabled())
    expect(master).toBeChecked()
    await user.click(master)
    await waitFor(() => expect(getLocalStore()[SITE_BOOKMARK_KEY]).toMatchObject({ enabled: false }))
    await user.click(screen.getByRole('checkbox', { name: '启用 github.com 规则' }))
    await waitFor(() => expect(getLocalStore()[SITE_BOOKMARK_KEY]).toMatchObject({ enabled: false, rules: [{ enabled: false }] }))
  })

  it('edits a rule through the inline form', async () => {
    await storeRules([rule])
    const user = userEvent.setup()
    render(<SiteBookmarkSettingsPanel />)
    await user.click(await screen.findByRole('button', { name: '编辑' }))
    const tagInput = await screen.findByLabelText('收藏标签')
    await user.clear(tagInput)
    await user.type(tagInput, '代码')
    await user.click(screen.getByRole('button', { name: '保存规则' }))
    await waitFor(() => expect(getLocalStore()[SITE_BOOKMARK_KEY]).toMatchObject({ rules: [{ tagName: '代码' }] }))
    expect(await screen.findByRole('button', { name: '编辑' })).toBeEnabled()
  })

  it('releases only unused origins when removing a rule and keeps X access', async () => {
    await chrome.permissions.request({ origins: [...siteOrigins('github.com'), 'https://x.com/*'] })
    await chrome.storage.local.set({ [X_BOOKMARK_KEY]: true })
    await storeRules([rule])
    const user = userEvent.setup()
    render(<SiteBookmarkSettingsPanel />)
    const remove = await screen.findByRole('button', { name: '删除 github.com 规则' })
    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    await waitFor(() => expect(getLocalStore()[SITE_BOOKMARK_KEY]).toMatchObject({ rules: [] }))
    // api.github.com 属于 manifest 必需权限，共享的 https 父域授权随之保留；http 授权被释放。
    await waitFor(async () => expect(await permissionsGetAll()).toEqual({ origins: ['https://*.github.com/*', 'https://x.com/*'] }))
  })

  it('keeps permissions that overlap other rules or the manifest', async () => {
    const nested: SiteRule = { ...rule, id: 'rule-2', domain: 'docs.github.com' }
    await chrome.permissions.request({ origins: [...siteOrigins('github.com'), ...siteOrigins('unrelated.test')] })
    await storeRules([rule, nested])
    const user = userEvent.setup()
    render(<SiteBookmarkSettingsPanel />)
    await user.click(await screen.findByRole('button', { name: '删除 github.com 规则' }))
    await waitFor(() => expect(getLocalStore()[SITE_BOOKMARK_KEY]).toMatchObject({ rules: [nested] }))
    await waitFor(async () => expect(await permissionsGetAll()).toEqual({
      origins: ['http://*.github.com/*', 'https://*.github.com/*', ...siteOrigins('unrelated.test')],
    }))
  })
})
