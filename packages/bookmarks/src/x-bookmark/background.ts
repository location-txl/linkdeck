import { MAX_BOOKMARK_TITLE_LENGTH } from '@linkdeck/shared'
import { bookmarkRepository } from '../bookmark-repository'
import { isXBookmarkEnabled } from './preferences'
import { X_ORIGIN, X_BOOKMARK_KEY, X_BOOKMARK_SAVE, X_BOOKMARK_STATE, X_BOOKMARK_REFRESH, X_BOOKMARK_STOP, type XBookmarkResponse } from './messages'

const SCRIPT_ID = 'linkdeck-x-bookmark-v1'
let pending: Promise<void> = Promise.resolve()

export function syncXBookmarkScripts(): Promise<void> {
  pending = pending.catch(() => undefined).then(async () => {
    const enabled = await isXBookmarkEnabled()
    const registered = (await chrome.scripting.getRegisteredContentScripts()).filter(({ id }) => id.startsWith('linkdeck-x-bookmark-'))
    if (registered.some(({ id }) => id !== SCRIPT_ID) || (!enabled && registered.length)) {
      await chrome.scripting.unregisterContentScripts({ ids: registered.map(({ id }) => id) })
    }
    if (enabled && (registered.length !== 1 || registered[0].id !== SCRIPT_ID)) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches: [X_ORIGIN], js: ['assets/x-bookmark-content.js'],
        runAt: 'document_idle', world: 'ISOLATED', persistAcrossSessions: true,
      }])
    }
    const tabs = await chrome.tabs.query({ url: X_ORIGIN })
    await Promise.all(tabs.map(async (tab) => {
      if (tab.id === undefined || !tab.url?.startsWith('https://x.com/')) return
      // 注销不会移除已注入的脚本；现有页面需要主动清理监听器和提示。
      if (!enabled) {
        await chrome.tabs.sendMessage(tab.id, { type: X_BOOKMARK_STOP }).catch(() => undefined)
      } else {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['assets/x-bookmark-content.js'] }).catch(() => undefined)
      }
    }))
  })
  return pending
}

export async function handleXBookmarkMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<XBookmarkResponse> {
  try {
    if (!message || typeof message !== 'object' || !('type' in message)) throw new Error('无效的收藏请求。')
    if (message.type === X_BOOKMARK_REFRESH) {
      if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(''))) throw new Error('无效的设置来源。')
      await syncXBookmarkScripts()
      return { ok: true }
    }
    if (!sender.tab || sender.frameId !== 0 || !sender.url?.startsWith('https://x.com/')) throw new Error('无效的 X 页面来源。')
    const enabled = await isXBookmarkEnabled()
    if (message.type === X_BOOKMARK_STATE) return { ok: true, enabled }
    if (message.type !== X_BOOKMARK_SAVE || !enabled) throw new Error('请先在 LinkDeck 设置中开启并授权 X 书签联动。')
    if (!('url' in message) || typeof message.url !== 'string' || !('title' in message) || typeof message.title !== 'string') throw new Error('无效的帖子信息。')
    const url = new URL(message.url)
    if (url.origin !== 'https://x.com' || url.username || url.password || !/^\/[a-zA-Z0-9_]+\/status\/\d+$/.test(url.pathname)) throw new Error('无法识别这条帖子的链接。')
    const result = await bookmarkRepository.createBookmark({
      url: `${url.origin}${url.pathname}`,
      title: message.title.trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH),
      tagIds: [], newTagNames: ['X'],
    })
    return { ok: true, created: result.created, tagsMerged: result.tagsMerged }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '收藏失败，请重试。' }
  }
}

export function registerXBookmarkBackground(): void {
  const refresh = () => { void syncXBookmarkScripts().catch((error: unknown) => console.warn('更新 X 收藏入口失败', error)) }
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message) ||
      ![X_BOOKMARK_SAVE, X_BOOKMARK_STATE, X_BOOKMARK_REFRESH].includes(message.type as string)) return undefined
    void handleXBookmarkMessage(message, sender).then(sendResponse)
    return true
  })
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[X_BOOKMARK_KEY]) refresh() })
  chrome.permissions.onAdded.addListener(refresh)
  chrome.permissions.onRemoved.addListener(refresh)
  chrome.runtime.onInstalled.addListener(refresh)
  chrome.runtime.onStartup.addListener(refresh)
  refresh()
}
