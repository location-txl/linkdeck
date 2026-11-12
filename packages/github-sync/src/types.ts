import type { CollectionSnapshot } from '@linkdeck/bookmarks'

export const GITHUB_SYNC_FILE_NAME = 'linkdeck-sync.json'
export const GITHUB_SYNC_STORAGE_KEY = 'linkdeck:github-sync'
export const LEGACY_GIST_STORAGE_KEY = 'linkdeck:gist-sync'

export type RepositoryTarget = {
  id: number
  fullName: string
  branch: string
}

export type RepositoryCredentials = {
  token: string
  repository: RepositoryTarget
}

export type GitHubSyncStatus = 'disconnected' | 'syncing' | 'synced' | 'error' | 'conflict'

/** 可发送给 popup 的同步状态。 */
export type GitHubSyncViewState = {
  status: GitHubSyncStatus
  repositoryUrl?: string
  lastSyncedAt?: string
  error?: string
  conflictCount?: number
}

export type StoredGitHubSyncState = {
  credentials: RepositoryCredentials
  baseline: CollectionSnapshot
  status: Exclude<GitHubSyncStatus, 'disconnected'>
  lastSyncedAt: string
  error?: string
  conflict?: {
    local: CollectionSnapshot
    remoteSha: string
    count: number
  }
}

export type BindingMode = 'remote' | 'local' | 'merge'
export type ConflictChoice = 'local' | 'remote'

export type BindingPreview = {
  version: string
  repositoryName: string
  local: { tags: number; bookmarks: number }
  remote: { tags: number; bookmarks: number } | null
}
