import type { BookmarkDraft } from '../types'
import { UserFacingError, fallbackTitleForUrl, normalizeUrl } from './bookmark-utils'

type BrowserTab = {
  title?: string
  url?: string
}

function hasChromeTabs(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs)
}

export async function getCurrentPageDraft(groupId: string): Promise<BookmarkDraft> {
  if (!hasChromeTabs()) {
    throw new UserFacingError('开发页面无法读取当前标签页，请手动添加网址。')
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url

  if (!url) {
    throw new UserFacingError('无法读取当前页面的网址。')
  }

  const normalizedUrl = normalizeUrl(url)
  return {
    title: tab.title?.trim() || fallbackTitleForUrl(normalizedUrl),
    url: normalizedUrl,
    groupId,
  }
}

export async function openBookmark(url: string, background = false): Promise<void> {
  if (hasChromeTabs()) {
    await chrome.tabs.create({ url, active: !background })
    return
  }

  window.open(url, background ? '_blank' : '_blank', 'noopener,noreferrer')
}

