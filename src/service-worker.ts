import { isGistSyncMessage } from './gist-sync/messages'
import { gistSyncService, hasLinkDeckStorageChange } from './gist-sync/gist-sync'

let syncTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = undefined
    void gistSyncService.handle({ type: 'gist-sync:sync-now' })
  }, 500)
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isGistSyncMessage(message)) return undefined
  void gistSyncService.handle(message).then(sendResponse)
  return true
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && hasLinkDeckStorageChange(changes)) scheduleSync()
})

chrome.runtime.onStartup.addListener(() => {
  void gistSyncService.handle({ type: 'gist-sync:sync-now' })
})
