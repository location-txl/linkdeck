import { GIST_SYNC_STORAGE_KEY, type GistSyncViewState } from './types'
import type { GistSyncMessage, GistSyncResponse } from './messages'

const disconnected: GistSyncViewState = { status: 'disconnected' }

function hasRuntimeMessaging(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

/** 向后台 worker 发同步请求；开发页面没有扩展 runtime 时安全降级为未连接。 */
export async function requestGistSync(message: GistSyncMessage): Promise<GistSyncResponse> {
  if (!hasRuntimeMessaging()) return { ok: true, state: disconnected }
  try {
    const response = await chrome.runtime.sendMessage(message) as GistSyncResponse | undefined
    if (!response || typeof response.ok !== 'boolean' || !response.state) {
      throw new Error('后台同步服务没有返回有效结果。')
    }
    return response
  } catch (error) {
    return {
      ok: false,
      state: { status: 'error', error: '后台同步服务不可用，请重新加载扩展后重试。' },
      error: error instanceof Error ? error.message : '后台同步服务不可用。',
    }
  }
}

export async function getGistSyncStatus(): Promise<GistSyncViewState> {
  return (await requestGistSync({ type: 'gist-sync:get-status' })).state
}

/** 订阅 worker 写入的本地状态，供 popup 顶部状态及时更新。 */
export function subscribeGistSyncStatus(onChange: (state: GistSyncViewState) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !changes[GIST_SYNC_STORAGE_KEY]) return
    void getGistSyncStatus().then(onChange)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
