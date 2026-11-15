import { GITHUB_SYNC_STORAGE_KEY, type GitHubSyncViewState } from './types'
import type { GitHubSyncMessage, GitHubSyncResponse } from './messages'

const disconnected: GitHubSyncViewState = { status: 'disconnected' }

function hasRuntimeMessaging(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

/** 向后台 worker 发同步请求；开发页面没有扩展 runtime 时安全降级为未连接。 */
export async function requestGitHubSync(message: GitHubSyncMessage): Promise<GitHubSyncResponse> {
  if (!hasRuntimeMessaging()) return { ok: true, state: disconnected }
  try {
    const response = await chrome.runtime.sendMessage(message) as GitHubSyncResponse | undefined
    if (!response || typeof response.ok !== 'boolean' || !response.state) {
      throw new Error('后台同步服务没有返回有效结果。')
    }
    return response
  } catch {
    return {
      ok: false,
      state: { status: 'error', error: '后台同步服务不可用，请重新加载扩展后重试。' },
      error: '后台同步服务不可用，请重新加载扩展后重试。',
    }
  }
}

export async function getGitHubSyncStatus(): Promise<GitHubSyncViewState> {
  return (await requestGitHubSync({ type: 'github-sync:get-status' })).state
}

/** 订阅 worker 写入的本地状态，供 popup 顶部状态及时更新。 */
export function subscribeGitHubSyncStatus(onChange: (state: GitHubSyncViewState) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !changes[GITHUB_SYNC_STORAGE_KEY]) return
    void getGitHubSyncStatus().then(onChange)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
