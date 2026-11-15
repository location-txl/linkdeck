import { getTabGroupSettings } from './preferences'

/** Chrome 用 -1 表示标签页尚未加入任何标签组。 */
const TAB_GROUP_ID_NONE = -1

function isGrouped(groupId: number | undefined): boolean {
  return groupId !== undefined && groupId !== TAB_GROUP_ID_NONE
}

/**
 * 处理一个新建标签页：把它和来源标签页归入同一标签组。
 *
 * 来源已在组内时直接加入该组；否则用来源标签页新建组，组名取来源页面标题。
 * 来源不存在、跨窗口、固定或已关闭等情况放弃本次成组，不影响新标签页本身。
 */
export async function handleTabGroupCreated(tab: chrome.tabs.Tab): Promise<void> {
  const settings = await getTabGroupSettings()
  if (!settings.enabled) return
  const tabId = tab.id
  if (tabId === undefined || tab.openerTabId === undefined) return
  if (isGrouped(tab.groupId)) return

  const opener = await chrome.tabs.get(tab.openerTabId)
  const openerId = opener.id
  if (openerId === undefined || opener.windowId !== tab.windowId || opener.pinned) return

  if (isGrouped(opener.groupId)) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: opener.groupId })
    return
  }
  const groupId = await chrome.tabs.group({ tabIds: [openerId, tabId], createProperties: { windowId: tab.windowId } })
  const title = opener.title?.trim()
  if (title) await chrome.tabGroups.update(groupId, { title })
}

/** 注册新建标签页监听。Service Worker 每次被唤醒只注册一次。 */
export function registerTabGroupService(): void {
  if (typeof chrome === 'undefined' || !chrome.tabs) return
  chrome.tabs.onCreated.addListener((tab) => {
    // 来源标签页可能在处理前被关闭等瞬时失败，直接放弃本次成组。
    void handleTabGroupCreated(tab).catch(() => undefined)
  })
}
