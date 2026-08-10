import type { LinkDeckBackup } from '../data-transfer/data-transfer'
import type { CollectionSnapshot } from '../types'

export const GIST_SYNC_FILE_NAME = 'linkdeck-sync.json'
export const GIST_SYNC_STORAGE_KEY = 'linkdeck:gist-sync'

/** Gist 文件中用于识别同步版本的元数据。 */
export type GistSyncMetadata = {
  protocolVersion: 1 | 2
  revisionId: string
  parentRevisionId: string | null
  writtenAt: string
}

/** 存放在 Gist 中的 LinkDeck 备份文件。 */
export type GistSyncDocument = LinkDeckBackup & {
  sync: GistSyncMetadata
}

/** 仅保存在当前浏览器配置文件中的 Gist 访问凭据。 */
export type GistCredentials = {
  token: string
  gistId: string
  gistUrl: string
}

export type GistSyncStatus = 'disconnected' | 'syncing' | 'synced' | 'error' | 'conflict'

/** 可安全发送给 popup 的同步状态，不包含访问令牌或数据快照。 */
export type GistSyncViewState = {
  status: GistSyncStatus
  gistUrl?: string
  lastSyncedAt?: string
  error?: string
  conflictCount?: number
}

/** 一次成功同步的共同基线，用来识别本机与远端的独立改动。 */
export type GistSyncBaseline = {
  revisionId: string
  snapshot: CollectionSnapshot
}

/** 等待用户统一选择来源的三方合并冲突。 */
export type GistSyncConflict = {
  base: CollectionSnapshot
  local: CollectionSnapshot
  remote: CollectionSnapshot
  remoteRevisionId: string
  conflicts: string[]
}

/** 保存在 chrome.storage.local 的完整同步状态。 */
export type StoredGistSyncState = {
  credentials?: GistCredentials
  baseline?: GistSyncBaseline
  status: GistSyncStatus
  lastSyncedAt?: string
  error?: string
  conflict?: GistSyncConflict
}

export type BindingMode = 'remote' | 'local' | 'merge'
export type ConflictChoice = 'local' | 'remote'

/** 用户绑定已有 Gist 前展示的本机与远端数据摘要。 */
export type GistBindingPreview = {
  gistId: string
  gistUrl: string
  local: { tags: number; bookmarks: number }
  remote: { tags: number; bookmarks: number }
}
