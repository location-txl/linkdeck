import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTabGroupCreated, registerTabGroupService } from './service'
import { setTabGroupSettings } from './preferences'
import {
  installChromeMock,
  setTabs,
  tabGroupsUpdate,
  tabsGet,
  tabsGroup,
  tabsOnCreatedListeners,
} from '@linkdeck/test-utils'

function createdTab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    active: false,
    autoDiscardable: true,
    discarded: false,
    groupId: -1,
    highlighted: false,
    incognito: false,
    index: 1,
    pinned: false,
    selected: false,
    windowId: 3,
    ...overrides,
  } as chrome.tabs.Tab
}

async function emitCreated(tab: Partial<chrome.tabs.Tab>) {
  for (const listener of tabsOnCreatedListeners) listener(tab)
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('tab group service', () => {
  beforeEach(() => {
    installChromeMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a group from the opener and names it with the opener title', async () => {
    setTabs([{ id: 10, windowId: 3, title: '来源页面', url: 'https://source.example.com' }])
    await setTabGroupSettings({ enabled: true })
    tabsGroup.mockResolvedValueOnce(77)

    await handleTabGroupCreated(createdTab({ id: 11, openerTabId: 10 }))

    expect(tabsGroup).toHaveBeenCalledWith({ tabIds: [10, 11], createProperties: { windowId: 3 } })
    expect(tabGroupsUpdate).toHaveBeenCalledWith(77, { title: '来源页面' })
  })

  it('joins the opener group without renaming it', async () => {
    setTabs([{ id: 10, windowId: 3, groupId: 55, title: '来源页面', url: 'https://source.example.com' }])
    await setTabGroupSettings({ enabled: true })

    await handleTabGroupCreated(createdTab({ id: 11, openerTabId: 10 }))

    expect(tabsGroup).toHaveBeenCalledWith({ tabIds: [11], groupId: 55 })
    expect(tabGroupsUpdate).not.toHaveBeenCalled()
  })

  it('skips naming when the opener has no title', async () => {
    setTabs([{ id: 10, windowId: 3, title: '', url: 'https://source.example.com' }])
    await setTabGroupSettings({ enabled: true })
    tabsGroup.mockResolvedValueOnce(77)

    await handleTabGroupCreated(createdTab({ id: 11, openerTabId: 10 }))

    expect(tabsGroup).toHaveBeenCalledWith({ tabIds: [10, 11], createProperties: { windowId: 3 } })
    expect(tabGroupsUpdate).not.toHaveBeenCalled()
  })

  it('does nothing while the feature is disabled', async () => {
    setTabs([{ id: 10, windowId: 3, title: '来源页面', url: 'https://source.example.com' }])

    await handleTabGroupCreated(createdTab({ id: 11, openerTabId: 10 }))

    expect(tabsGroup).not.toHaveBeenCalled()
  })

  it.each([
    ['缺少来源标签页', createdTab({ id: 11 })],
    ['新标签页已在组内', createdTab({ id: 11, openerTabId: 10, groupId: 5 })],
  ])('ignores a new tab when %s', async (_label, tab) => {
    setTabs([{ id: 10, windowId: 3, title: '来源页面', url: 'https://source.example.com' }])
    await setTabGroupSettings({ enabled: true })

    await handleTabGroupCreated(tab)

    expect(tabsGroup).not.toHaveBeenCalled()
  })

  it.each([
    ['跨窗口打开', [{ id: 10, windowId: 3, title: '来源页面', url: 'https://source.example.com' }], createdTab({ id: 11, openerTabId: 10, windowId: 9 })],
    ['来源是固定标签页', [{ id: 10, windowId: 3, pinned: true, title: '来源页面', url: 'https://source.example.com' }], createdTab({ id: 11, openerTabId: 10 })],
  ])('ignores a new tab when %s', async (_label, openerTabs, tab) => {
    setTabs(openerTabs)
    await setTabGroupSettings({ enabled: true })

    await handleTabGroupCreated(tab)

    expect(tabsGroup).not.toHaveBeenCalled()
  })

  it('gives up silently when the opener tab is gone', async () => {
    await setTabGroupSettings({ enabled: true })
    tabsGet.mockRejectedValueOnce(new Error('No tab with id: 10'))
    registerTabGroupService()

    await emitCreated(createdTab({ id: 11, openerTabId: 10 }))

    expect(tabsGroup).not.toHaveBeenCalled()
  })

  it('registers one onCreated listener', () => {
    registerTabGroupService()

    expect(tabsOnCreatedListeners).toHaveLength(1)
  })
})
