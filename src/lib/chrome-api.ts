import type { BookmarkDraft } from '../types'
import { UserFacingError, fallbackTitleForUrl, normalizeUrl } from './bookmark-utils'

type BrowserTab = {
  title?: string
  url?: string
}

function hasChromeTabs(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs)
}

/** 从当前浏览器标签页生成一个默认不带标签的收藏草稿。 */
export async function getCurrentPageDraft(): Promise<BookmarkDraft> {
  if (!hasChromeTabs()) throw new UserFacingError('开发页面无法读取当前标签页，请手动添加网址。')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }) as BrowserTab[]
  if (!tab?.url) throw new UserFacingError('无法读取当前页面的网址。')
  const url = normalizeUrl(tab.url)
  return {
    title: tab.title?.trim() || fallbackTitleForUrl(url),
    url,
    tagIds: [],
    newTagNames: [],
  }
}

export async function openBookmark(url: string, background = false): Promise<void> {
  if (hasChromeTabs()) {
    await chrome.tabs.create({ url, active: !background })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 在新的浏览器标签页中打开 LinkDeck 全屏管理页面。 */
export async function openManagerPage(): Promise<void> {
  const path = 'index.html?view=manager'
  const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(path, window.location.href).href
  if (hasChromeTabs()) {
    await chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 在新的浏览器标签页中打开关闭历史页面。 */
export async function openCloseHistoryPage(): Promise<void> {
  const path = 'index.html?view=close-history'
  const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(path, window.location.href).href
  if (hasChromeTabs()) {
    await chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
