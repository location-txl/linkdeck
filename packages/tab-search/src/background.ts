import { isTabSearchMessage, TAB_SEARCH_COMMAND } from './messages'
import { handleTabSearchMessage } from './service'

const TAB_SEARCH_OVERLAY_FILE = 'assets/tab-search-overlay.js'

/** 在快捷键触发的活动网页上注入标签页搜索浮层。 */
async function injectTabSearchOverlay(tab?: chrome.tabs.Tab): Promise<void> {
  if (tab?.id === undefined) return
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [TAB_SEARCH_OVERLAY_FILE],
    })
  } catch (error: unknown) {
    // chrome://、扩展商店和其他受保护页面不允许 activeTab 注入，只记录而不影响后台功能。
    console.warn('打开标签页搜索浮层失败', error)
  }
}

/** 注册快捷键和搜索浮层使用的后台消息。 */
export function registerTabSearchBackground(): void {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === TAB_SEARCH_COMMAND) void injectTabSearchOverlay(tab)
  })
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isTabSearchMessage(message)) return undefined
    void handleTabSearchMessage(message, sender).then(sendResponse)
    return true
  })
}
