import { bookmarkRepository } from '../lib/bookmark-repository'
import { STORAGE_KEYS, type CollectionSnapshot } from '../types'
import { parseBackupJson } from '../data-transfer/data-transfer'
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
  type GistPendingWrite,
  type GistSyncConflict,
  type GistSyncViewState,
  type StoredGistSyncState,
} from './types'

type StorageRecord = Record<string, unknown>

type PushSnapshotResult = {
  remote: RemoteGist
  verified: boolean
  pendingWrite?: GistPendingWrite
}

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

/** 将 local storage 中遗留的 v1 同步基线和冲突快照转换为当前标签格式。 */
function migrateStoredSnapshot(value: unknown): CollectionSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const snapshot = value as { meta?: { schemaVersion?: unknown } }
  const formatVersion = snapshot.meta?.schemaVersion === 1 ? 1 : snapshot.meta?.schemaVersion === 2 ? 2 : undefined
  if (!formatVersion) return undefined
  try {
    return parseBackupJson(JSON.stringify({
      app: 'LinkDeck',
      formatVersion,
      exportedAt: '1970-01-01T00:00:00.000Z',
      data: value,
    })).data
  } catch {
    return undefined
  }
}

function normalizeStoredState(value: unknown): StoredGistSyncState {
  if (!isStoredState(value)) return defaultState()
  const state = clone(value)
  if (state.baseline) {
    const snapshot = migrateStoredSnapshot(state.baseline.snapshot)
    if (snapshot) state.baseline.snapshot = snapshot
    else state.baseline = undefined
  }
  if (state.pendingWrite) {
    const snapshot = migrateStoredSnapshot(state.pendingWrite.parentSnapshot)
    if (snapshot) state.pendingWrite.parentSnapshot = snapshot
    else state.pendingWrite = undefined
  }
  if (state.conflict) {
    const base = migrateStoredSnapshot(state.conflict.base)
    const local = migrateStoredSnapshot(state.conflict.local)
    const remote = migrateStoredSnapshot(state.conflict.remote)
    if (base && local && remote) state.conflict = { ...state.conflict, base, local, remote }
    else state.conflict = undefined
  }
  return state
}

function defaultState(): StoredGistSyncState {
  return { status: 'disconnected' }
}

async function readStoredState(): Promise<StoredGistSyncState> {
  if (hasChromeLocalStorage()) {
    const stored = await chrome.storage.local.get(GIST_SYNC_STORAGE_KEY) as StorageRecord
    const value = stored[GIST_SYNC_STORAGE_KEY]
    return normalizeStoredState(value)
  }
  const value = fallbackStorage.get(GIST_SYNC_STORAGE_KEY)
  return normalizeStoredState(value)
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

function summary(snapshot: CollectionSnapshot): { tags: number; bookmarks: number } {
  return {
    tags: snapshot.meta.tags.length,
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
    (key) => key === STORAGE_KEYS.meta || key.startsWith(STORAGE_KEYS.tagPrefix) ||
      key.startsWith(STORAGE_KEYS.bookmarkPrefix),
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
      if (!sameSnapshot(local, await bookmarkRepository.load())) {
        throw new Error('绑定期间本机数据已变化，请重新确认同步方式。')
      }
      await bookmarkRepository.importSnapshot(remote.document.data, 'replace', local)
      const upgraded = await this.upgradeLegacyRemote(credentials, remote, remote.document.data)
      return this.saveSynced(
        credentials,
        upgraded.remote,
        remote.document.data,
        upgraded.pendingWrite,
      )
    }

    const next = mode === 'merge' ? mergeInitialSnapshots(local, remote.document.data) : local
    if (!sameSnapshot(next, local)) {
      if (!sameSnapshot(local, await bookmarkRepository.load())) {
        throw new Error('绑定期间本机数据已变化，请重新确认同步方式。')
      }
      await bookmarkRepository.importSnapshot(next, 'replace', local)
    }
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
    return this.saveSynced(credentials, pushed.remote, next, pushed.pendingWrite)
  }

  private async syncInternal(attempt = 0): Promise<GistSyncViewState> {
    const stored = await readStoredState()
    if (!stored.credentials) return { status: 'disconnected', error: stored.error }
    if (stored.status === 'conflict' && stored.conflict) {
      return this.recoverCompletedWrite(stored)
    }
    if (!stored.baseline) {
      throw new Error('同步基线已丢失，请断开后重新绑定 Gist。')
    }

    await writeStoredState({ ...stored, status: 'syncing', error: undefined })
    const remote = await readGist(stored.credentials.token, stored.credentials.gistId)
    // 远端请求期间 popup 仍可能写入收藏，因此必须在请求完成后读取本机快照。
    const local = await bookmarkRepository.load()
    let baseline = stored.baseline

    if (stored.pendingWrite) {
      const parentStillVisible =
        remote.document.sync.revisionId === stored.pendingWrite.parentRevisionId &&
        sameSnapshot(remote.document.data, stored.pendingWrite.parentSnapshot)
      if (parentStillVisible) {
        const pending: StoredGistSyncState = {
          ...stored,
          status: 'syncing',
          error: undefined,
        }
        await writeStoredState(pending)
        return viewOf(pending)
      }

      const writeVisible =
        remote.document.sync.revisionId === baseline.revisionId &&
        sameSnapshot(remote.document.data, baseline.snapshot)
      const directDescendantVisible =
        remote.document.sync.parentRevisionId === baseline.revisionId

      // 未确认写入若被基于旧父版本的并发 PATCH 覆盖，必须从旧父基线重新合并。
      if (!writeVisible && !directDescendantVisible) {
        baseline = {
          revisionId: stored.pendingWrite.parentRevisionId,
          snapshot: stored.pendingWrite.parentSnapshot,
        }
      }
    }

    if (sameSnapshot(local, remote.document.data)) {
      const upgraded = await this.upgradeLegacyRemote(stored.credentials, remote, local)
      return this.saveSynced(
        stored.credentials,
        upgraded.remote,
        local,
        upgraded.pendingWrite,
      )
    }

    const localChanged = !sameSnapshot(local, baseline.snapshot)
    const remoteChanged = !sameSnapshot(remote.document.data, baseline.snapshot)

    if (!localChanged && remoteChanged) {
      const interrupted = await this.guardLocalBeforeReplace(local, baseline.snapshot, remote, attempt)
      if (interrupted) return interrupted
      await bookmarkRepository.importSnapshot(remote.document.data, 'replace', local)
      const upgraded = await this.upgradeLegacyRemote(stored.credentials, remote, remote.document.data)
      return this.saveSynced(
        stored.credentials,
        upgraded.remote,
        remote.document.data,
        upgraded.pendingWrite,
      )
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
      return this.saveSynced(stored.credentials, pushed.remote, local, pushed.pendingWrite)
    }

    if (!localChanged && !remoteChanged) {
      const upgraded = await this.upgradeLegacyRemote(stored.credentials, remote, local)
      return this.saveSynced(
        stored.credentials,
        upgraded.remote,
        local,
        upgraded.pendingWrite,
      )
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
    await bookmarkRepository.importSnapshot(merged.snapshot, 'replace', local)
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
    return this.saveSynced(
      stored.credentials,
      pushed.remote,
      merged.snapshot,
      pushed.pendingWrite,
    )
  }

  /**
   * 自动清理旧版本因写后短暂读到父 revision 而保存的假冲突。
   *
   * 只有远端已经精确等于冲突本机侧、revision 直接继承冲突记录的远端版本，
   * 且本机数据此后没有变化时才更新基线；其他冲突继续等待用户选择。
   */
  private async recoverCompletedWrite(stored: StoredGistSyncState): Promise<GistSyncViewState> {
    const conflict = stored.conflict
    if (!stored.credentials || !conflict) return viewOf(stored)

    try {
      const remote = await readGist(stored.credentials.token, stored.credentials.gistId)
      const local = await bookmarkRepository.load()
      if (
        remote.document.sync.parentRevisionId !== conflict.remoteRevisionId ||
        !sameSnapshot(remote.document.data, conflict.local) ||
        !sameSnapshot(local, conflict.local)
      ) {
        return viewOf(stored)
      }

      // 网络请求完成后再确认一次，避免用已过期的本机快照建立新基线。
      if (!sameSnapshot(local, await bookmarkRepository.load())) return viewOf(stored)
      return this.saveSynced(stored.credentials, remote, local)
    } catch {
      // 自动修复失败不能隐藏原冲突；后续打开 popup 或浏览器启动时会再次检查。
      return viewOf(stored)
    }
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
    const latestLocal = await bookmarkRepository.load()
    if (!sameSnapshot(local, latestLocal)) {
      const recalculated = mergeThreeWaySnapshots(conflict.base, latestLocal, remote.document.data)
      return this.saveConflict(
        conflict.base,
        latestLocal,
        remote.document.data,
        recalculated.conflicts.length > 0
          ? recalculated.conflicts
          : ['冲突处理期间本机数据发生变化，请重新选择来源。'],
        remote.document.sync.revisionId,
      )
    }
    await bookmarkRepository.importSnapshot(resolved.snapshot, 'replace', local)
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
    return this.saveSynced(
      stored.credentials,
      pushed.remote,
      resolved.snapshot,
      pushed.pendingWrite,
    )
  }

  private async pushSnapshot(
    credentials: GistCredentials,
    snapshot: CollectionSnapshot,
    remote: RemoteGist,
  ): Promise<PushSnapshotResult> {
    const document = createGistDocument(snapshot, remote.document.sync.revisionId)
    const updated = await updateGist(credentials, document)
    const updateAccepted =
      updated.document.sync.revisionId === document.sync.revisionId &&
      sameSnapshot(updated.document.data, snapshot)
    if (!updateAccepted) return { remote: updated, verified: false }

    const visible = await readGist(credentials.token, credentials.gistId)
    const updateVisible =
      visible.document.sync.revisionId === document.sync.revisionId &&
      sameSnapshot(visible.document.data, snapshot)
    if (updateVisible) return { remote: visible, verified: true }

    // Gist 的 PATCH 已返回新内容，但紧随其后的 GET 可能短暂仍返回写入前的父 revision。
    const parentStillVisible =
      visible.document.sync.revisionId === remote.document.sync.revisionId &&
      sameSnapshot(visible.document.data, remote.document.data)
    return {
      remote: parentStillVisible ? updated : visible,
      verified: parentStillVisible,
      pendingWrite: parentStillVisible
        ? {
            parentRevisionId: remote.document.sync.revisionId,
            parentSnapshot: clone(remote.document.data),
          }
        : undefined,
    }
  }

  /** 首次读取旧协议 Gist 后立即写回 v2，阻止旧客户端继续覆盖标签数据。 */
  private async upgradeLegacyRemote(
    credentials: GistCredentials,
    remote: RemoteGist,
    snapshot: CollectionSnapshot,
  ): Promise<PushSnapshotResult> {
    if (remote.document.sync.protocolVersion === 2) return { remote, verified: true }
    const pushed = await this.pushSnapshot(credentials, snapshot, remote)
    if (!pushed.verified) {
      throw new Error('升级 Gist 同步格式时远端数据发生变化，请重新同步。')
    }
    return pushed
  }

  private async saveSynced(
    credentials: GistCredentials,
    remote: RemoteGist,
    snapshot: CollectionSnapshot,
    pendingWrite?: GistPendingWrite,
  ): Promise<GistSyncViewState> {
    const state: StoredGistSyncState = {
      credentials,
      baseline: {
        revisionId: remote.document.sync.revisionId,
        snapshot: clone(snapshot),
      },
      pendingWrite: pendingWrite ? clone(pendingWrite) : undefined,
      status: pendingWrite ? 'syncing' : 'synced',
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
      pendingWrite: undefined,
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
