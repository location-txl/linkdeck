export const TAB_SEARCH_COMMAND = 'open-tab-search'

export type TabSearchTab = {
  id: number
  index: number
  title: string
  url: string
  favIconUrl?: string
  active: boolean
  pinned: boolean
}

/** 浏览器历史搜索结果在浮层中展示和打开所需的最小字段集合。 */
export type TabSearchHistoryItem = {
  id: string
  title: string
  url: string
  lastVisitTime?: number
}

export type TabSearchMessage =
  | { type: 'tab-search:get-tabs' }
  | { type: 'tab-search:get-history'; query: string }
  | { type: 'tab-search:activate-tab'; tabId: number }
  | { type: 'tab-search:open-history'; url: string }

export type TabSearchResponse =
  | { ok: true; tabs: TabSearchTab[] }
  | { ok: true; history: TabSearchHistoryItem[] }
  | { ok: true }
  | { ok: false; error: string }

/** 判断消息是否属于标签页搜索功能，避免 service worker 误处理其他消息。 */
export function isTabSearchMessage(message: unknown): message is TabSearchMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as { type?: unknown; tabId?: unknown; query?: unknown; url?: unknown }
  if (candidate.type === 'tab-search:get-tabs') return true
  if (candidate.type === 'tab-search:get-history') return typeof candidate.query === 'string'
  if (candidate.type === 'tab-search:activate-tab') {
    return typeof candidate.tabId === 'number' && Number.isInteger(candidate.tabId)
  }
  return candidate.type === 'tab-search:open-history'
    && typeof candidate.url === 'string'
    && candidate.url.trim().length > 0
}
