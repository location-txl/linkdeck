import { STORAGE_KEYS } from './types'
import { handleAutoCloseStartup, handleAutoCloseStorageChange, registerAutoCloseService } from './service'

/** 接入自动关闭的标签事件、设置变更和启动时的计时重置。 */
export function registerAutoCloseBackground(): void {
  registerAutoCloseService()
  chrome.storage.onChanged.addListener((changes, areaName) => {
    void handleAutoCloseStorageChange(changes[STORAGE_KEYS.autoCloseSettings], areaName)
  })
  const reset = () => { void handleAutoCloseStartup() }
  chrome.runtime.onStartup.addListener(reset)
  chrome.runtime.onInstalled.addListener(reset)
}
