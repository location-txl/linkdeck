import { STORAGE_KEYS } from './types'
import {
  SAME_TAB_CONFIG_EVENT,
  SAME_TAB_GET_RULE,
  SAME_TAB_REQUEST_EVENT,
  SAME_TAB_UPDATE,
  type SameTabResponse,
} from './messages'

(() => {
  const host = window as Window & { __linkdeckSameTabBridgeCleanup?: () => void }
  host.__linkdeckSameTabBridgeCleanup?.()
  let revision = 0
  const publish = (rule: SameTabResponse['rule']) => {
    window.dispatchEvent(new CustomEvent(SAME_TAB_CONFIG_EVENT, { detail: rule ?? null }))
  }
  const refresh = () => {
    const requestRevision = ++revision
    void chrome.runtime.sendMessage({ type: SAME_TAB_GET_RULE })
      .then((response: SameTabResponse) => {
        if (requestRevision === revision) publish(response?.ok ? response.rule : null)
      })
      .catch(() => { if (requestRevision === revision) publish(null) })
  }
  const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[STORAGE_KEYS.sameTabSettings]) {
      // 先停止旧规则，再异步读取带权限校验的新规则。
      ++revision
      publish(null)
      refresh()
    }
  }
  const onMessage = (message: unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== SAME_TAB_UPDATE) return
    ++revision
    publish(null)
    refresh()
  }
  window.addEventListener(SAME_TAB_REQUEST_EVENT, refresh)
  chrome.storage.onChanged.addListener(onStorageChange)
  chrome.runtime.onMessage.addListener(onMessage)
  host.__linkdeckSameTabBridgeCleanup = () => {
    ++revision
    window.removeEventListener(SAME_TAB_REQUEST_EVENT, refresh)
    chrome.storage.onChanged.removeListener(onStorageChange)
    chrome.runtime.onMessage.removeListener(onMessage)
  }
  refresh()
})()
