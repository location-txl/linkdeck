import type { TabSearchHistoryItem, TabSearchMessage, TabSearchResponse, TabSearchTab } from './messages'

const UNKNOWN_WINDOW_ERROR = '无法确定当前浏览器窗口。'
const CROSS_WINDOW_ERROR = '不能切换其他窗口的标签页。'
const CLOSED_TAB_ERROR = '目标标签页已关闭，请重新搜索。'
const HISTORY_READ_ERROR = '读取浏览器历史记录失败，请重新尝试。'
const HISTORY_OPEN_ERROR = '打开历史记录失败，请重新尝试。'
const MAX_VISIBLE_HISTORY_SEARCH_RESULTS = 100
// 限定历史搜索的时间范围，避免在用户主动切换到历史模式时读取更早记录。
const HISTORY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

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

function toTabSearchHistoryItem(item: chrome.history.HistoryItem): TabSearchHistoryItem | undefined {
  const url = item.url?.trim()
  if (!url) return undefined
  return {
    id: item.id,
    title: item.title?.trim() || '未命名页面',
    url,
    lastVisitTime: item.lastVisitTime,
  }
}

/** 查询浏览器历史记录并转换为浮层需要的最小字段集合。 */
async function getHistory(query: string): Promise<TabSearchHistoryItem[]> {
  const items = await chrome.history.search({
    text: query.trim(),
    startTime: Date.now() - HISTORY_LOOKBACK_MS,
    maxResults: MAX_VISIBLE_HISTORY_SEARCH_RESULTS,
  })
  return items
    .map(toTabSearchHistoryItem)
    .filter((item): item is TabSearchHistoryItem => item !== undefined)
}

/** 在当前窗口复用历史记录对应的标签页，否则创建一个前台标签页。 */
async function openHistory(url: string, windowId: number): Promise<void> {
  const targetUrl = url.trim()
  if (!targetUrl) throw new Error(HISTORY_OPEN_ERROR)

  const tabs = await chrome.tabs.query({ windowId })
  const existingTab = tabs.find((tab) => tab.id !== undefined && tab.url === targetUrl)
  if (existingTab?.id !== undefined) {
    await chrome.tabs.update(existingTab.id, { active: true })
    return
  }

  await chrome.tabs.create({ windowId, url: targetUrl, active: true })
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

    if (message.type === 'tab-search:get-history') {
      return { ok: true, history: await getHistory(message.query) }
    }

    if (message.type === 'tab-search:open-history') {
      await openHistory(message.url, windowId)
      return { ok: true }
    }

    const target = await chrome.tabs.get(message.tabId)
    if (target.windowId !== windowId) return { ok: false, error: CROSS_WINDOW_ERROR }
    await chrome.tabs.update(message.tabId, { active: true })
    return { ok: true }
  } catch (error: unknown) {
    const operation = message.type === 'tab-search:get-tabs'
      ? '读取标签页失败'
      : message.type === 'tab-search:get-history'
        ? '读取浏览器历史记录失败'
        : message.type === 'tab-search:open-history'
          ? '打开历史记录失败'
          : '激活标签页失败'
    console.warn(operation, error)
    return {
      ok: false,
      error: message.type === 'tab-search:get-tabs'
        ? '读取标签页失败，请重新尝试。'
        : message.type === 'tab-search:get-history'
          ? HISTORY_READ_ERROR
          : message.type === 'tab-search:open-history'
            ? HISTORY_OPEN_ERROR
            : CLOSED_TAB_ERROR,
    }
  }
}
