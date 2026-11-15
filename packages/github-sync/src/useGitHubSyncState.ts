import { useEffect, useState } from 'react'
import { getGitHubSyncStatus, requestGitHubSync, subscribeGitHubSyncStatus } from './client'
import type { GitHubSyncViewState } from './types'

/** 页面打开时同步一次，并订阅后台保存的同步状态。 */
export function useGitHubSyncState() {
  const [state, setState] = useState<GitHubSyncViewState>({ status: 'disconnected' })
  useEffect(() => {
    let alive = true
    const updateState = (next: GitHubSyncViewState) => {
      if (alive) setState(next)
    }
    void getGitHubSyncStatus().then(updateState)
    void requestGitHubSync({ type: 'github-sync:sync-now' }).then((response) => updateState(response.state))
    const unsubscribe = subscribeGitHubSyncStatus(updateState)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return { state, setState }
}
