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

export type TabSearchMessage =
  | { type: 'tab-search:get-tabs' }
  | { type: 'tab-search:activate-tab'; tabId: number }

export type TabSearchResponse =
  | { ok: true; tabs: TabSearchTab[] }
  | { ok: true }
  | { ok: false; error: string }

/** 判断消息是否属于标签页搜索功能，避免 service worker 误处理其他消息。 */
export function isTabSearchMessage(message: unknown): message is TabSearchMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as { type?: unknown; tabId?: unknown }
  if (candidate.type === 'tab-search:get-tabs') return true
  return candidate.type === 'tab-search:activate-tab'
    && typeof candidate.tabId === 'number'
    && Number.isInteger(candidate.tabId)
}
