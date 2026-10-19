import { Icon } from '@linkdeck/ui/icon'
import type { GistSyncViewState } from './types'

function gistSyncLabel(state: GistSyncViewState): string {
  if (state.status === 'synced') return 'Gist 已同步'
  if (state.status === 'syncing') return '同步中'
  if (state.status === 'conflict') return '同步冲突'
  if (state.status === 'error') return '同步失败'
  return '已保存'
}

function gistSyncTitle(state: GistSyncViewState): string {
  return state.status === 'disconnected' ? '已保存到浏览器同步存储' : state.error ?? gistSyncLabel(state)
}

export function GistSyncStatus({ state }: { state: GistSyncViewState }) {
  return <span className="sync-state" title={gistSyncTitle(state)}><Icon name="cloud" size={15} /><span>{gistSyncLabel(state)}</span></span>
}
