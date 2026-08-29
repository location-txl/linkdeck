import type { TabSearchMessage, TabSearchResponse, TabSearchTab } from './messages'

const UNKNOWN_WINDOW_ERROR = '无法确定当前浏览器窗口。'
const CROSS_WINDOW_ERROR = '不能切换其他窗口的标签页。'
const CLOSED_TAB_ERROR = '目标标签页已关闭，请重新搜索。'

function getSenderWindowId(sender: chrome.runtime.MessageSender): number | undefined {
  return sender.tab?.windowId
}

function toTabSearchTab(tab: chrome.tabs.Tab): TabSearchTab | undefined {
  if (tab.id === undefined) return undefined
  return {
    id: tab.id,
    index: tab.index,
    title: tab.title?.trim() || '未命名标签页',
    url: tab.url ?? '',
    favIconUrl: tab.favIconUrl || undefined,
    active: tab.active,
    pinned: tab.pinned,
  }
}

/** 读取发送方所在窗口的标签页，并只返回悬浮层需要的字段。 */
async function getTabs(windowId: number): Promise<TabSearchTab[]> {
  const tabs = await chrome.tabs.query({ windowId })
  return tabs
    .filter((tab) => tab.windowId === windowId)
    .map(toTabSearchTab)
    .filter((tab): tab is TabSearchTab => tab !== undefined)
    .sort((left, right) => left.index - right.index)
}

/** 处理内容脚本的查询和激活请求，所有跨窗口操作都在后台校验。 */
export async function handleTabSearchMessage(
  message: TabSearchMessage,
  sender: chrome.runtime.MessageSender,
): Promise<TabSearchResponse> {
  const windowId = getSenderWindowId(sender)
  if (windowId === undefined) return { ok: false, error: UNKNOWN_WINDOW_ERROR }

  try {
    if (message.type === 'tab-search:get-tabs') {
      return { ok: true, tabs: await getTabs(windowId) }
    }

    const target = await chrome.tabs.get(message.tabId)
    if (target.windowId !== windowId) return { ok: false, error: CROSS_WINDOW_ERROR }
    await chrome.tabs.update(message.tabId, { active: true })
    return { ok: true }
  } catch (error: unknown) {
    console.warn(message.type === 'tab-search:get-tabs' ? '读取标签页失败' : '激活标签页失败', error)
    return {
      ok: false,
      error: message.type === 'tab-search:get-tabs' ? '读取标签页失败，请重新尝试。' : CLOSED_TAB_ERROR,
    }
  }
}
