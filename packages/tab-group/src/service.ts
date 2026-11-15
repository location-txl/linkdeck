import { getTabGroupSettings } from './preferences'

/** Chrome 用 -1 表示标签页尚未加入任何标签组。 */
const TAB_GROUP_ID_NONE = -1

/** 每个来源标签页一条 Promise 队列，串行化并发的成组处理。 */
const openerQueues = new Map<number, Promise<void>>()

function isGrouped(groupId: number | undefined): boolean {
  return groupId !== undefined && groupId !== TAB_GROUP_ID_NONE
}

/**
 * 处理一个新建标签页：把它和来源标签页归入同一标签组。
 *
 * 来源已在组内时直接加入该组；否则用来源标签页新建组，组名取来源页面标题。
 * 来源不存在、跨窗口、固定或已关闭等情况放弃本次成组，不影响新标签页本身。
 *
 * 同一来源的并发新建事件串行处理：后到的子标签页会重新读到来源的最新组归属，
 * 加入先创建的组，而不是各自建组把来源标签页来回搬移。
 */
export function handleTabGroupCreated(tab: chrome.tabs.Tab): Promise<void> {
  const openerId = tab.openerTabId
  if (openerId === undefined) return Promise.resolve()
  // 前序任务的失败不影响本次处理。
  const previous = openerQueues.get(openerId)?.catch(() => undefined) ?? Promise.resolve()
  const run = previous.then(() => groupWithOpener(tab, openerId)).finally(() => {
    if (openerQueues.get(openerId) === run) openerQueues.delete(openerId)
  })
  openerQueues.set(openerId, run)
  return run
}

async function groupWithOpener(tab: chrome.tabs.Tab, openerId: number): Promise<void> {
  const settings = await getTabGroupSettings()
  if (!settings.enabled) return
  const tabId = tab.id
  if (tabId === undefined || isGrouped(tab.groupId)) return

  const opener = await chrome.tabs.get(openerId)
  if (opener.id === undefined || opener.windowId !== tab.windowId || opener.pinned) return

  if (isGrouped(opener.groupId)) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: opener.groupId })
    return
  }
  const groupId = await chrome.tabs.group({ tabIds: [opener.id, tabId], createProperties: { windowId: tab.windowId } })
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
