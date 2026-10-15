import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getLocalStore, getSyncStore, installChromeMock, permissionsGetAll, permissionsRequest, runtimeSendMessage, setCurrentTab } from '../test/chrome'
import { STORAGE_KEYS } from '../types'
import { SameTabSettingsPanel } from './SameTabSettings'
import { setSameTabSettings } from './preferences'
import { siteOrigins } from './rules'

describe('当前标签页打开设置', () => {
  beforeEach(() => { installChromeMock(); setCurrentTab({ id: 1, url: 'https://scys.com/article/1' }) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('adds the current website, changes its scope and saves locally', async () => {
    const user = userEvent.setup()
    render(<SameTabSettingsPanel />)
    const add = await screen.findByRole('button', { name: '添加当前网站 scys.com' })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ['http://*.scys.com/*', 'https://*.scys.com/*'] })
    const select = await screen.findByRole('combobox', { name: 'scys.com 的打开范围' })
    await user.selectOptions(select, 'site')
    await user.click(screen.getByRole('checkbox', { name: /启用当前标签页打开/ }))
    await waitFor(() => expect(getLocalStore()[STORAGE_KEYS.sameTabSettings]).toEqual({ enabled: true, sites: [{ domain: 'scys.com', scope: 'site' }] }))
    expect(getSyncStore()).toEqual({})
    await user.click(screen.getByRole('button', { name: '移除网站 scys.com' }))
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('rejects duplicate and invalid input without requesting permissions', async () => {
    const user = userEvent.setup()
    render(<SameTabSettingsPanel />)
    const input = screen.getByRole('textbox')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'chrome://settings')
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('有效的域名')
    expect(permissionsRequest).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'https://scys.com/a')
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    await screen.findByRole('combobox')
    await user.type(input, 'SCYS.com')
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已经添加')
    expect(permissionsRequest).toHaveBeenCalledTimes(1)
  })

  it('does not add a rule when permission is denied', async () => {
    permissionsRequest.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    render(<SameTabSettingsPanel />)
    const input = screen.getByRole('textbox')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'scys.com')
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('未获得网站权限')
    expect(getLocalStore()[STORAGE_KEYS.sameTabSettings]).toBeUndefined()
    expect(input).toHaveValue('scys.com')
  })

  it('preserves the input and releases newly granted access if saving fails', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('storage full'))
    const user = userEvent.setup()
    render(<SameTabSettingsPanel />)
    const input = screen.getByRole('textbox')
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'scys.com')
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('storage full')
    expect(input).toHaveValue('scys.com')
    expect(await permissionsGetAll()).toEqual({ origins: [] })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('rolls back stored settings if applying scripts fails', async () => {
    runtimeSendMessage.mockResolvedValueOnce({ ok: false, error: 'cannot register' })
    await expect(setSameTabSettings({ enabled: true, sites: [{ domain: 'scys.com', scope: 'all' }] })).rejects.toThrow('cannot register')
    expect(getLocalStore()[STORAGE_KEYS.sameTabSettings]).toEqual({ enabled: false, sites: [] })
  })

  it.each([
    ['example.com', 'docs.example.com'],
    ['docs.example.com', 'example.com'],
  ])('releases overlapping permissions after removing %s then %s', async (first, second) => {
    const user = userEvent.setup()
    await chrome.permissions.request({ origins: [...siteOrigins('example.com'), ...siteOrigins('docs.example.com')] })
    await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: {
      enabled: true,
      sites: [{ domain: 'example.com', scope: 'all' }, { domain: 'docs.example.com', scope: 'all' }],
    } })
    render(<SameTabSettingsPanel />)
    const firstRemove = await screen.findByRole('button', { name: `移除网站 ${first}` })
    await waitFor(() => expect(firstRemove).toBeEnabled())
    await user.click(firstRemove)
    await waitFor(() => expect(screen.queryByRole('button', { name: `移除网站 ${first}` })).not.toBeInTheDocument())
    expect(await chrome.permissions.contains({ origins: siteOrigins(second) })).toBe(true)
    const secondRemove = screen.getByRole('button', { name: `移除网站 ${second}` })
    await waitFor(() => expect(secondRemove).toBeEnabled())
    await user.click(secondRemove)
    await waitFor(async () => expect(await permissionsGetAll()).toEqual({ origins: [] }))
    expect(getLocalStore()[STORAGE_KEYS.sameTabSettings]).toEqual({ enabled: true, sites: [] })
  })

  it('keeps required and unrelated website permissions when removing a rule', async () => {
    const user = userEvent.setup()
    const requiredOrigin = 'https://api.github.com/*'
    vi.spyOn(chrome.runtime, 'getManifest').mockReturnValue({ manifest_version: 3, name: 'LinkDeck', version: '1.1.0', host_permissions: [requiredOrigin] })
    await chrome.permissions.request({ origins: [requiredOrigin, ...siteOrigins('github.com'), ...siteOrigins('unrelated.example')] })
    await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: {
      enabled: true,
      sites: [{ domain: 'github.com', scope: 'all' }],
    } })
    render(<SameTabSettingsPanel />)
    const remove = await screen.findByRole('button', { name: '移除网站 github.com' })
    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    await waitFor(async () => expect(await permissionsGetAll()).toEqual({ origins: [requiredOrigin, 'https://*.github.com/*', ...siteOrigins('unrelated.example')] }))
  })
})
