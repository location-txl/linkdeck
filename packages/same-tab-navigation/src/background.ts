import { STORAGE_KEYS } from './types'
import {
  handleSameTabMessage,
  isSameTabMessage,
  registerSameTabNavigationService,
  syncSameTabNavigation,
} from './service'

/** 接入导航消息、配置变化、网站权限和浏览器启动恢复。 */
export function registerSameTabNavigationBackground(): void {
  registerSameTabNavigationService()
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isSameTabMessage(message)) return undefined
    void handleSameTabMessage(message, sender).then(sendResponse)
    return true
  })
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.sameTabSettings]) {
      void syncSameTabNavigation().catch((error: unknown) => console.warn('更新当前标签页导航失败', error))
    }
  })
  const restore = () => {
    void syncSameTabNavigation().catch((error: unknown) => console.warn('恢复当前标签页导航失败', error))
  }
  chrome.runtime.onStartup.addListener(restore)
  chrome.runtime.onInstalled.addListener(restore)
}
