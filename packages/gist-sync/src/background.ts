import { hasLinkDeckStorageChange } from '@linkdeck/bookmarks/storage-changes'
import { gistSyncService } from './gist-sync'
import { isGistSyncMessage, type GistSyncMessage, type GistSyncResponse } from './messages'

const LOCAL_CHANGE_DEBOUNCE_MS = 500
const PENDING_WRITE_RETRY_MS = 3_000
let syncTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSync(delayMs = LOCAL_CHANGE_DEBOUNCE_MS): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = undefined
    void handleGistSyncMessage({ type: 'gist-sync:sync-now' })
  }, delayMs)
}

/** 远端写入尚未可见时继续验证，直到 revision 与已接受的 PATCH 对齐。 */
async function handleGistSyncMessage(message: GistSyncMessage): Promise<GistSyncResponse> {
  const response = await gistSyncService.handle(message)
  if (message.type !== 'gist-sync:get-status' && response.state.status === 'syncing') {
    scheduleSync(PENDING_WRITE_RETRY_MS)
  }
  return response
}

/** 注册同步消息、收藏变更防抖和浏览器启动后的同步。 */
export function registerGistSyncBackground(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isGistSyncMessage(message)) return undefined
    void handleGistSyncMessage(message).then(sendResponse)
    return true
  })
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && hasLinkDeckStorageChange(changes)) scheduleSync()
  })
  const sync = () => { void handleGistSyncMessage({ type: 'gist-sync:sync-now' }) }
  chrome.runtime.onStartup.addListener(sync)
  chrome.runtime.onInstalled.addListener(sync)
}
