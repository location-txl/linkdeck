import { bookmarkRepository } from '../lib/bookmark-repository'
import { STORAGE_KEYS, type CollectionSnapshot } from '../types'
import {
  createGist,
  createGistDocument,
  parseGistId,
  readGist,
  updateGist,
  type RemoteGist,
} from './gist-api'
import type { GistSyncMessage, GistSyncResponse } from './messages'
import {
  mergeInitialSnapshots,
  mergeThreeWaySnapshots,
  sameSnapshot,
} from './snapshot-merge'
import {
  GIST_SYNC_STORAGE_KEY,
  type GistBindingPreview,
  type GistCredentials,
  type GistSyncConflict,
  type GistSyncViewState,
  type StoredGistSyncState,
} from './types'

type StorageRecord = Record<string, unknown>

const fallbackStorage = new Map<string, unknown>()

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasChromeLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function isStoredState(value: unknown): value is StoredGistSyncState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredGistSyncState>
  return ['disconnected', 'syncing', 'synced', 'error', 'conflict'].includes(candidate.status ?? '')
}

function defaultState(): StoredGistSyncState {
  return { status: 'disconnected' }
}

async function readStoredState(): Promise<StoredGistSyncState> {
  if (hasChromeLocalStorage()) {
    const stored = await chrome.storage.local.get(GIST_SYNC_STORAGE_KEY) as StorageRecord
    const value = stored[GIST_SYNC_STORAGE_KEY]
    return isStoredState(value) ? clone(value) : defaultState()
  }
  const value = fallbackStorage.get(GIST_SYNC_STORAGE_KEY)
  return isStoredState(value) ? clone(value) : defaultState()
}

async function writeStoredState(state: StoredGistSyncState): Promise<void> {
  if (hasChromeLocalStorage()) {
    await chrome.storage.local.set({ [GIST_SYNC_STORAGE_KEY]: state })
    return
  }
  fallbackStorage.set(GIST_SYNC_STORAGE_KEY, clone(state))
}

async function clearStoredState(): Promise<void> {
  if (hasChromeLocalStorage()) {
    await chrome.storage.local.remove(GIST_SYNC_STORAGE_KEY)
    return
  }
  fallbackStorage.delete(GIST_SYNC_STORAGE_KEY)
}

function viewOf(state: StoredGistSyncState): GistSyncViewState {
  return {
    status: state.status,
    gistUrl: state.credentials?.gistUrl,
    lastSyncedAt: state.lastSyncedAt,
    error: state.error,
    conflictCount: state.conflict?.conflicts.length,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Gist 同步发生未知错误。'
}

function summary(snapshot: CollectionSnapshot): { groups: number; bookmarks: number } {
  return {
    groups: snapshot.meta.groups.length,
    bookmarks: snapshot.bookmarks.length,
  }
}

function writeErrorState(
  state: StoredGistSyncState,
  error: string,
): StoredGistSyncState {
  if (!state.credentials) return { status: 'disconnected', error }
  return {
    ...state,
    status: 'error',
    error,
  }
}

/** 判断 storage.sync 的变更是否会影响 LinkDeck 收藏快照。 */
export function hasLinkDeckStorageChange(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some(
    (key) => key === STORAGE_KEYS.meta || key.startsWith(STORAGE_KEYS.bookmarkPrefix),
  )
}

/**
 * 协调 Gist 的读写、基线与三方合并。
 *
 * 所有操作通过内部队列串行执行，避免一个 popup 生命周期中并发请求互相覆盖状态。
 */
export class GistSyncService {
  private queue: Promise<void> = Promise.resolve()

  async getStatus(): Promise<GistSyncViewState> {
    return viewOf(await readStoredState())
  }

  async handle(message: GistSyncMessage): Promise<GistSyncResponse> {
    try {
      switch (message.type) {
        case 'gist-sync:get-status':
          return { ok: true, state: await this.getStatus() }
        case 'gist-sync:sync-now':
          return { ok: true, state: await this.enqueue(() => this.syncInternal()) }
        case 'gist-sync:connect': {
          const result = await this.enqueue(() => this.connect(message.token, message.gistInput))
          return { ok: true, ...result }
        }
        case 'gist-sync:confirm-bind':
          return {
            ok: true,
            state: await this.enqueue(() => this.confirmBinding(message.token, message.gistId, message.mode)),
          }
        case 'gist-sync:resolve-conflict':
          return {
            ok: true,
            state: await this.enqueue(() => this.resolveConflict(message.choice)),
          }
        case 'gist-sync:disconnect':
          await this.enqueue(() => this.disconnect())
          return { ok: true, state: { status: 'disconnected' } }
      }
    } catch (error) {
      const state = await this.recordFailure(error)
      return { ok: false, state, error: errorMessage(error) }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async recordFailure(error: unknown): Promise<GistSyncViewState> {
    const state = await readStoredState()
    const failed = writeErrorState(state, errorMessage(error))
    if (failed.credentials) await writeStoredState(failed)
    return viewOf(failed)
  }

  private async connect(
    rawToken: string,
    gistInput?: string,
  ): Promise<{ state: GistSyncViewState; preview?: GistBindingPreview }> {
    const token = rawToken.trim()
    if (!token) throw new Error('请输入 GitHub 细粒度访问令牌。')

    const input = gistInput?.trim()
    if (input) {
      const gistId = parseGistId(input)
      const [local, remote] = await Promise.all([
        bookmarkRepository.load(),
        readGist(token, gistId),
      ])
      return {
        state: await this.getStatus(),
        preview: {
          gistId: remote.id,
          gistUrl: remote.url,
          local: summary(local),
          remote: summary(remote.document.data),
        },
      }
    }

    const snapshot = await bookmarkRepository.load()
    const remote = await createGist(token, snapshot)
    const credentials: GistCredentials = { token, gistId: remote.id, gistUrl: remote.url }
    return { state: await this.saveSynced(credentials, remote, snapshot) }
  }

  private async confirmBinding(
    rawToken: string,
    gistId: string,
    mode: 'remote' | 'local' | 'merge',
  ): Promise<GistSyncViewState> {
    const token = rawToken.trim()
    if (!token) throw new Error('请输入 GitHub 细粒度访问令牌。')

    const remote = await readGist(token, gistId)
    const local = await bookmarkRepository.load()
    const credentials: GistCredentials = { token, gistId: remote.id, gistUrl: remote.url }

    if (mode === 'remote') {
      await bookmarkRepository.importSnapshot(remote.document.data, 'replace')
      return this.saveSynced(credentials, remote, remote.document.data)
    }

    const next = mode === 'merge' ? mergeInitialSnapshots(local, remote.document.data) : local
    if (!sameSnapshot(next, local)) await bookmarkRepository.importSnapshot(next, 'replace')
    const pushed = await this.pushSnapshot(credentials, next, remote)
    if (!pushed.verified) {
      return this.saveConflict(
        local,
        next,
        pushed.remote.document.data,
        ['Gist 在写入后被其他设备更新，请选择冲突来源。'],
        pushed.remote.document.sync.revisionId,
      )
    }
    return this.saveSynced(credentials, pushed.remote, next)
  }

  private async syncInternal(attempt = 0): Promise<GistSyncViewState> {
    const stored = await readStoredState()
    if (!stored.credentials) return { status: 'disconnected', error: stored.error }
    if (stored.status === 'conflict' && stored.conflict) return viewOf(stored)
    if (!stored.baseline) {
      throw new Error('同步基线已丢失，请断开后重新绑定 Gist。')
    }

    await writeStoredState({ ...stored, status: 'syncing', error: undefined })
    const remote = await readGist(stored.credentials.token, stored.credentials.gistId)
    // 远端请求期间 popup 仍可能写入收藏，因此必须在请求完成后读取本机快照。
    const local = await bookmarkRepository.load()
    const baseline = stored.baseline

    if (sameSnapshot(local, remote.document.data)) {
      return this.saveSynced(stored.credentials, remote, local)
    }

    const localChanged = !sameSnapshot(local, baseline.snapshot)
    const remoteChanged = !sameSnapshot(remote.document.data, baseline.snapshot)

    if (!localChanged && remoteChanged) {
      const interrupted = await this.guardLocalBeforeReplace(local, baseline.snapshot, remote, attempt)
      if (interrupted) return interrupted
      await bookmarkRepository.importSnapshot(remote.document.data, 'replace')
      return this.saveSynced(stored.credentials, remote, remote.document.data)
    }

    if (localChanged && !remoteChanged) {
      const pushed = await this.pushSnapshot(stored.credentials, local, remote)
      if (!pushed.verified) {
        return this.saveConflict(
          baseline.snapshot,
          local,
          pushed.remote.document.data,
          ['Gist 在写入后被其他设备更新，请选择冲突来源。'],
          pushed.remote.document.sync.revisionId,
        )
      }
      return this.saveSynced(stored.credentials, pushed.remote, local)
    }

    if (!localChanged && !remoteChanged) {
      return this.saveSynced(stored.credentials, remote, local)
    }

    const merged = mergeThreeWaySnapshots(baseline.snapshot, local, remote.document.data)
    if (merged.conflicts.length > 0) {
      return this.saveConflict(
        baseline.snapshot,
        local,
        remote.document.data,
        merged.conflicts,
        remote.document.sync.revisionId,
      )
    }

    const latest = await readGist(stored.credentials.token, stored.credentials.gistId)
    if (latest.document.sync.revisionId !== remote.document.sync.revisionId) {
      if (attempt < 1) return this.syncInternal(attempt + 1)
      return this.saveConflict(
        baseline.snapshot,
        local,
        latest.document.data,
        ['同步过程中 Gist 连续发生变化，请选择冲突来源。'],
        latest.document.sync.revisionId,
      )
    }

    const interrupted = await this.guardLocalBeforeReplace(local, baseline.snapshot, latest, attempt)
    if (interrupted) return interrupted
    await bookmarkRepository.importSnapshot(merged.snapshot, 'replace')
    const pushed = await this.pushSnapshot(stored.credentials, merged.snapshot, latest)
    if (!pushed.verified) {
      return this.saveConflict(
        baseline.snapshot,
        merged.snapshot,
        pushed.remote.document.data,
        ['Gist 在写入后被其他设备更新，请选择冲突来源。'],
        pushed.remote.document.sync.revisionId,
      )
    }
    return this.saveSynced(stored.credentials, pushed.remote, merged.snapshot)
  }

  /**
   * 在覆盖本机数据前确认同步期间没有新的本机写入。
   *
   * 检测到首次变化时重新读取两端；若数据持续变化则保留双方快照并交给用户处理，
   * 避免为了追赶更新而覆盖刚写入的收藏。
   */
  private async guardLocalBeforeReplace(
    expectedLocal: CollectionSnapshot,
    base: CollectionSnapshot,
    remote: RemoteGist,
    attempt: number,
  ): Promise<GistSyncViewState | undefined> {
    const latestLocal = await bookmarkRepository.load()
    if (sameSnapshot(expectedLocal, latestLocal)) return undefined
    if (attempt < 1) return this.syncInternal(attempt + 1)
    return this.saveConflict(
      base,
      latestLocal,
      remote.document.data,
      ['同步过程中本机数据连续发生变化，请重新选择来源。'],
      remote.document.sync.revisionId,
    )
  }

  private async resolveConflict(choice: 'local' | 'remote'): Promise<GistSyncViewState> {
    const stored = await readStoredState()
    const conflict = stored.conflict
    if (!stored.credentials || !conflict) throw new Error('当前没有可处理的同步冲突。')

    const remote = await readGist(stored.credentials.token, stored.credentials.gistId)
    const local = await bookmarkRepository.load()
    if (
      !sameSnapshot(local, conflict.local) ||
      remote.document.sync.revisionId !== conflict.remoteRevisionId
    ) {
      const recalculated = mergeThreeWaySnapshots(conflict.base, local, remote.document.data)
      return this.saveConflict(
        conflict.base,
        local,
        remote.document.data,
        recalculated.conflicts.length > 0
          ? recalculated.conflicts
          : ['冲突处理期间数据发生变化，请重新选择来源。'],
        remote.document.sync.revisionId,
      )
    }

    const resolved = mergeThreeWaySnapshots(conflict.base, local, remote.document.data, choice)
    await bookmarkRepository.importSnapshot(resolved.snapshot, 'replace')
    const pushed = await this.pushSnapshot(stored.credentials, resolved.snapshot, remote)
    if (!pushed.verified) {
      return this.saveConflict(
        conflict.base,
        resolved.snapshot,
        pushed.remote.document.data,
        ['Gist 在冲突处理后再次发生变化，请重新选择来源。'],
        pushed.remote.document.sync.revisionId,
      )
    }
    return this.saveSynced(stored.credentials, pushed.remote, resolved.snapshot)
  }

  private async pushSnapshot(
    credentials: GistCredentials,
    snapshot: CollectionSnapshot,
    remote: RemoteGist,
  ): Promise<{ remote: RemoteGist; verified: boolean }> {
    const document = createGistDocument(snapshot, remote.document.sync.revisionId)
    await updateGist(credentials, document)
    const verified = await readGist(credentials.token, credentials.gistId)
    return {
      remote: verified,
      verified:
        verified.document.sync.revisionId === document.sync.revisionId &&
        sameSnapshot(verified.document.data, snapshot),
    }
  }

  private async saveSynced(
    credentials: GistCredentials,
    remote: RemoteGist,
    snapshot: CollectionSnapshot,
  ): Promise<GistSyncViewState> {
    const state: StoredGistSyncState = {
      credentials,
      baseline: {
        revisionId: remote.document.sync.revisionId,
        snapshot: clone(snapshot),
      },
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
    }
    await writeStoredState(state)
    return viewOf(state)
  }

  private async saveConflict(
    base: CollectionSnapshot,
    local: CollectionSnapshot,
    remote: CollectionSnapshot,
    conflicts: string[],
    remoteRevisionId: string,
  ): Promise<GistSyncViewState> {
    const stored = await readStoredState()
    if (!stored.credentials) return { status: 'disconnected' }
    const conflict: GistSyncConflict = {
      base: clone(base),
      local: clone(local),
      remote: clone(remote),
      remoteRevisionId,
      conflicts,
    }
    const state: StoredGistSyncState = {
      ...stored,
      status: 'conflict',
      error: undefined,
      conflict,
    }
    await writeStoredState(state)
    return viewOf(state)
  }

  private async disconnect(): Promise<void> {
    await clearStoredState()
  }
}

export const gistSyncService = new GistSyncService()
