import { bookmarkRepository } from './bookmark-repository'
import { hasLinkDeckStorageChange } from './storage-changes'
import { MAX_BOOKMARK_TITLE_LENGTH, hasSameUrl } from '@linkdeck/shared'

const SAVE_CURRENT_PAGE_MENU_ID = 'linkdeck:save-current-page'
const SAVED_BADGE_TEXT = '✓'
const SAVED_BADGE_COLOR = '#3f7d5f'
const DEFAULT_ACTION_TITLE = 'LinkDeck'
const SAVED_ACTION_TITLE = 'LinkDeck · 已收藏'

type BadgeTab = {
  id?: number
  active?: boolean
  url?: string
}

/**
 * 根据标签页当前网址刷新工具栏角标，使用与收藏仓库相同的 URL 比较规则。
 *
 * @param tabId 需要更新角标的浏览器标签页 ID。
 * @returns 角标更新完成后的 Promise；标签页不存在或无法读取时静默清除状态。
 */
async function refreshTabBadge(tabId: number): Promise<void> {
  try {
    const [tab, snapshot] = await Promise.all([
      chrome.tabs.get(tabId) as Promise<BadgeTab>,
      bookmarkRepository.load(),
    ])
    const url = tab.url
    const isWebPage = Boolean(url && /^https?:\/\//i.test(url))
    const isSaved = isWebPage && snapshot.bookmarks.some((bookmark) => hasSameUrl(bookmark.url, url!))
    await chrome.action.setBadgeText({ tabId, text: isSaved ? SAVED_BADGE_TEXT : '' })
    await chrome.action.setTitle({ tabId, title: isSaved ? SAVED_ACTION_TITLE : DEFAULT_ACTION_TITLE })
  } catch (error: unknown) {
    // 标签页可能在异步读取期间关闭；此时只清除遗留角标，不影响收藏和同步流程。
    console.warn('刷新收藏角标失败', error)
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined)
    await chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE }).catch(() => undefined)
  }
}

/** 刷新每个浏览器窗口当前活动标签页，避免收藏变更后保留旧角标。 */
async function refreshActiveTabBadges(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true }) as BadgeTab[]
  await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [refreshTabBadge(tab.id)]))
}

/** 创建唯一的网页右键收藏入口，更新扩展时会先清理旧菜单。 */
function registerContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SAVE_CURRENT_PAGE_MENU_ID,
      title: '收藏当前页到 LinkDeck',
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    })
  })
}

/** 将右键所在网页保存为无标签收藏，复用仓库层的校验与去重行为。 */
async function saveCurrentPage(pageUrl: string, title?: string): Promise<void> {
  await bookmarkRepository.createBookmark({
    title: title?.trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH) ?? '',
    url: pageUrl,
    tagIds: [],
    newTagNames: [],
  })
}

/** 注册收藏角标、右键收藏和启动恢复所需的后台事件。 */
export function registerBookmarkBackground(): void {
  void chrome.action.setBadgeBackgroundColor({ color: SAVED_BADGE_COLOR })
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void refreshTabBadge(tabId)
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.active || changeInfo.url === undefined) return
    void refreshTabBadge(tabId)
  })

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== SAVE_CURRENT_PAGE_MENU_ID) return
    const pageUrl = info.pageUrl ?? tab?.url
    if (!pageUrl) return
    void saveCurrentPage(pageUrl, tab?.title).catch((error: unknown) => {
      console.error('右键收藏失败', error)
    })
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && hasLinkDeckStorageChange(changes)) void refreshActiveTabBadges()
  })
  chrome.runtime.onStartup.addListener(() => { void refreshActiveTabBadges() })
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenu()
    void refreshActiveTabBadges()
  })
}
