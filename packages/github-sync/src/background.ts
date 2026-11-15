import { hasLinkDeckStorageChange } from '@linkdeck/bookmarks/storage-changes'
import { isGitHubSyncMessage, type GitHubSyncResponse } from './messages'
import { githubSyncService } from './sync-service'
import { LEGACY_GIST_STORAGE_KEY } from './types'

const LOCAL_CHANGE_DEBOUNCE_MS = 500
let syncTimer: ReturnType<typeof setTimeout> | undefined

const unavailable: GitHubSyncResponse = {
  ok: false,
  state: { status: 'error' },
  error: '无法读取或保存 GitHub 同步设置，请稍后重试。',
}

export function registerGitHubSyncBackground(): void {
  const sync = () => { void githubSyncService.handle({ type: 'github-sync:sync-now' }).catch(() => undefined) }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isGitHubSyncMessage(message)) return undefined
    void githubSyncService.handle(message).then(sendResponse, () => sendResponse(unavailable))
    return true
  })
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !hasLinkDeckStorageChange(changes)) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(sync, LOCAL_CHANGE_DEBOUNCE_MS)
  })
  chrome.runtime.onStartup.addListener(sync)
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.storage.local.remove(LEGACY_GIST_STORAGE_KEY).then(sync, sync)
  })
}
