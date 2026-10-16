import { useEffect, useState } from 'react'
import { getGistSyncStatus, requestGistSync, subscribeGistSyncStatus } from './client'
import type { GistSyncViewState } from './types'

/** 页面打开时同步一次，并订阅后台保存的同步状态。 */
export function useGistSyncState() {
  const [state, setState] = useState<GistSyncViewState>({ status: 'disconnected' })
  useEffect(() => {
    let alive = true
    const updateState = (next: GistSyncViewState) => {
      if (alive) setState(next)
    }
    void getGistSyncStatus().then(updateState)
    void requestGistSync({ type: 'gist-sync:sync-now' }).then((response) => updateState(response.state))
    const unsubscribe = subscribeGistSyncStatus(updateState)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return { state, setState }
}
