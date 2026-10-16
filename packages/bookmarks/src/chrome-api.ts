import type { BookmarkDraft } from './types'
import { UserFacingError, fallbackTitleForUrl, normalizeUrl } from '@linkdeck/shared'

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
