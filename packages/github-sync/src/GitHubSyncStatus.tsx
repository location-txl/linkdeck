import { Icon } from '@linkdeck/ui/icon'
import type { GitHubSyncViewState } from './types'

function githubSyncLabel(state: GitHubSyncViewState): string {
  if (state.status === 'synced') return 'GitHub 已同步'
  if (state.status === 'syncing') return '同步中'
  if (state.status === 'conflict') return state.conflictCount ? '同步冲突' : '等待确认'
  if (state.status === 'error') return '同步失败'
  return '已保存'
}

function githubSyncTitle(state: GitHubSyncViewState): string {
  return state.status === 'disconnected' ? '已保存到浏览器同步存储' : state.error ?? githubSyncLabel(state)
}

export function GitHubSyncStatus({ state }: { state: GitHubSyncViewState }) {
  return <span className="sync-state" title={githubSyncTitle(state)}><Icon name="cloud" size={15} /><span>{githubSyncLabel(state)}</span></span>
}
