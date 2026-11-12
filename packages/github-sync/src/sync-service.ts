import { bookmarkRepository } from '@linkdeck/bookmarks/repository'
import type { CollectionSnapshot } from '@linkdeck/bookmarks'
import { UserFacingError } from '@linkdeck/shared'
import type { GitHubSyncMessage, GitHubSyncResponse } from './messages'
import {
  parseRepositoryName,
  readRepository,
  readRepositoryFile,
  RepositoryApiError,
  verifyRepository,
  writeRepositoryFile,
  type RemoteFile,
} from './repository-api'
import { mergeInitialSnapshots, mergeThreeWaySnapshots, sameSnapshot } from './snapshot-merge'
import {
  GITHUB_SYNC_FILE_NAME,
  GITHUB_SYNC_STORAGE_KEY,
  type BindingPreview,
  type ConflictChoice,
  type GitHubSyncViewState,
  type RepositoryCredentials,
  type StoredGitHubSyncState,
} from './types'

const disconnected: GitHubSyncViewState = { status: 'disconnected' }

async function readState(): Promise<StoredGitHubSyncState | undefined> {
  const result = await chrome.storage.local.get(GITHUB_SYNC_STORAGE_KEY)
  return result[GITHUB_SYNC_STORAGE_KEY] as StoredGitHubSyncState | undefined
}

function viewOf(state: StoredGitHubSyncState | undefined): GitHubSyncViewState {
  if (!state) return disconnected
  return {
    status: state.status,
    repositoryUrl: 'https://github.com/' + state.credentials.repository.fullName,
    lastSyncedAt: state.lastSyncedAt,
    error: state.error,
    conflictCount: state.conflict?.count,
  }
}

async function saveState(state: StoredGitHubSyncState): Promise<GitHubSyncViewState> {
  await chrome.storage.local.set({ [GITHUB_SYNC_STORAGE_KEY]: state })
  return viewOf(state)
}

function summary(snapshot: CollectionSnapshot) {
  return { tags: snapshot.meta.tags.length, bookmarks: snapshot.bookmarks.length }
}

function requiredFile(file: RemoteFile | null): RemoteFile {
  if (!file) throw new UserFacingError('仓库中找不到 ' + GITHUB_SYNC_FILE_NAME + '，请恢复文件或断开后重新绑定。')
  return file
}

async function readBoundFile(credentials: RepositoryCredentials): Promise<RemoteFile> {
  await verifyRepository(credentials)
  return requiredFile(await readRepositoryFile(credentials))
}

async function publish(
  credentials: RepositoryCredentials,
  snapshot: CollectionSnapshot,
  remote: RemoteFile | null,
): Promise<RemoteFile | null | undefined> {
  if (remote && sameSnapshot(snapshot, remote.snapshot)) return
  try {
    await writeRepositoryFile(credentials, snapshot, remote?.sha ?? null)
  } catch (error) {
    if (!(error instanceof RepositoryApiError) || (error.status !== 409 && error.status !== 422)) throw error
    await verifyRepository(credentials)
    const latest = await readRepositoryFile(credentials)
    if (latest?.sha === remote?.sha) throw error
    return latest
  }
}

async function finishSync(
  credentials: RepositoryCredentials,
  snapshot: CollectionSnapshot,
  local: CollectionSnapshot,
): Promise<GitHubSyncViewState> {
  // 远端写入后，本机快照仍须通过收藏仓库锁内的比较才能被替换。
  if (!sameSnapshot(snapshot, local)) await bookmarkRepository.importSnapshot(snapshot, 'replace', local)
  return saveState({ credentials, baseline: snapshot, status: 'synced', lastSyncedAt: new Date().toISOString() })
}

function saveConflict(
  stored: StoredGitHubSyncState,
  local: CollectionSnapshot,
  remote: RemoteFile,
  count: number,
  error?: string,
): Promise<GitHubSyncViewState> {
  return saveState({
    ...stored,
    status: 'conflict',
    error,
    conflict: { local, remoteSha: remote.sha, count },
  })
}

export class GitHubSyncService {
  private queue: Promise<unknown> = Promise.resolve()

  handle(message: GitHubSyncMessage): Promise<GitHubSyncResponse> {
    if (message.type === 'github-sync:get-status') {
      return readState().then((stored) => ({ ok: true, state: viewOf(stored) }))
    }
    const operation = this.queue.then(() => this.run(message))
    this.queue = operation.catch(() => undefined)
    return operation
  }

  private async run(message: Exclude<GitHubSyncMessage, { type: 'github-sync:get-status' }>): Promise<GitHubSyncResponse> {
    const stored = await readState()
    try {
      switch (message.type) {
        case 'github-sync:preview':
        case 'github-sync:confirm-bind':
          if (stored) throw new UserFacingError('请先断开当前 GitHub 仓库。')
          return await this.bind(message)
        case 'github-sync:disconnect':
          await chrome.storage.local.remove(GITHUB_SYNC_STORAGE_KEY)
          return { ok: true, state: disconnected }
        case 'github-sync:sync-now':
          return { ok: true, state: stored ? await this.sync(stored) : disconnected }
        case 'github-sync:resolve-conflict':
          if (!stored?.conflict) throw new UserFacingError('当前没有可处理的同步冲突。')
          return { ok: true, state: await this.resolveConflict(stored, message.choice) }
      }
    } catch (error) {
      const messageText = error instanceof UserFacingError ? error.message : 'GitHub 同步失败，请稍后重试。'
      const isSync = message.type === 'github-sync:sync-now' || message.type === 'github-sync:resolve-conflict'
      const state = stored && isSync
        ? await saveState({ ...stored, status: 'error', error: messageText })
        : viewOf(stored)
      return { ok: false, state, error: messageText }
    }
  }

  private async bind(
    message: Extract<GitHubSyncMessage, { type: 'github-sync:preview' | 'github-sync:confirm-bind' }>,
  ): Promise<GitHubSyncResponse> {
    const token = message.token.trim()
    if (!token) throw new UserFacingError('请输入 GitHub 细粒度访问令牌。')
    const repository = await readRepository(token, parseRepositoryName(message.repositoryInput))
    const credentials = { repository, token }
    const remote = await readRepositoryFile(credentials)
    const local = await bookmarkRepository.load()
    const preview = (file: RemoteFile | null): BindingPreview => ({
      version: JSON.stringify([repository.id, repository.branch, file?.sha ?? null]),
      repositoryName: repository.fullName,
      local: summary(local),
      remote: file ? summary(file.snapshot) : null,
    })

    const current = preview(remote)
    if (message.type === 'github-sync:preview') return { ok: true, state: disconnected, preview: current }
    const changed = (next: BindingPreview): GitHubSyncResponse => ({
      ok: true,
      state: disconnected,
      preview: next,
      error: '远端在预览后发生变化，请重新确认绑定。',
    })
    if (message.version !== current.version) return changed(current)

    const snapshot = message.mode === 'local'
      ? local
      : message.mode === 'remote'
        ? requiredFile(remote).snapshot
        : mergeInitialSnapshots(local, requiredFile(remote).snapshot)
    const latest = await publish(credentials, snapshot, remote)
    if (latest !== undefined) return changed(preview(latest))
    return { ok: true, state: await finishSync(credentials, snapshot, local) }
  }

  private async sync(stored: StoredGitHubSyncState): Promise<GitHubSyncViewState> {
    if (stored.status === 'conflict') return viewOf(stored)
    const { credentials, baseline } = stored
    await saveState({ ...stored, status: 'syncing', error: undefined })
    let remote = await readBoundFile(credentials)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const local = await bookmarkRepository.load()
      const merged = mergeThreeWaySnapshots(baseline, local, remote.snapshot)
      if (merged.conflicts.length) return saveConflict(stored, local, remote, merged.conflicts.length)

      const latest = await publish(credentials, merged.snapshot, remote)
      if (latest === undefined) return finishSync(credentials, merged.snapshot, local)
      remote = requiredFile(latest)
    }

    const local = await bookmarkRepository.load()
    const merged = mergeThreeWaySnapshots(baseline, local, remote.snapshot)
    if (merged.conflicts.length) return saveConflict(stored, local, remote, merged.conflicts.length)
    throw new UserFacingError('仓库在同步期间连续更新，请稍后重新同步。')
  }

  private async resolveConflict(stored: StoredGitHubSyncState, choice: ConflictChoice): Promise<GitHubSyncViewState> {
    const { credentials, baseline, conflict } = stored
    const remote = await readBoundFile(credentials)
    const local = await bookmarkRepository.load()
    const refresh = (nextLocal: CollectionSnapshot, nextRemote: RemoteFile) => {
      const merged = mergeThreeWaySnapshots(baseline, nextLocal, nextRemote.snapshot)
      return saveConflict(stored, nextLocal, nextRemote, merged.conflicts.length, '同步数据已变化，请重新选择冲突来源。')
    }

    if (!conflict || conflict.remoteSha !== remote.sha || !sameSnapshot(conflict.local, local)) {
      return refresh(local, remote)
    }
    const resolved = mergeThreeWaySnapshots(baseline, local, remote.snapshot, choice)
    const latest = await publish(credentials, resolved.snapshot, remote)
    if (latest !== undefined) return refresh(await bookmarkRepository.load(), requiredFile(latest))
    return finishSync(credentials, resolved.snapshot, local)
  }
}

export const githubSyncService = new GitHubSyncService()
