import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bookmarkRepository } from '../lib/bookmark-repository'
import { getLocalStore, installChromeMock } from '../test/chrome'
import { createGistDocument, parseGistDocument, serializeGistDocument } from './gist-api'
import { GistSyncService } from './gist-sync'
import type { GistSyncDocument } from './types'
import { GIST_SYNC_FILE_NAME } from './types'
import { GIST_SYNC_STORAGE_KEY } from './types'

function response(value: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => value } as Response
}

describe('GistSyncService', () => {
  let service: GistSyncService
  let remote: GistSyncDocument | undefined
  let beforeNextRead: (() => Promise<void>) | undefined
  let keepParentVisibleAfterNextPatch: boolean
  let staleRemote: GistSyncDocument | undefined
  let afterNextPatch: ((patched: GistSyncDocument) => GistSyncDocument) | undefined

  const gistResponse = (document: GistSyncDocument) => ({
    id: 'gist-1',
    html_url: 'https://gist.github.com/example/gist-1',
    files: {
      [GIST_SYNC_FILE_NAME]: {
        content: serializeGistDocument(document),
        truncated: false,
      },
    },
  })

  beforeEach(() => {
    installChromeMock()
    service = new GistSyncService()
    remote = undefined
    beforeNextRead = undefined
    keepParentVisibleAfterNextPatch = false
    staleRemote = undefined
    afterNextPatch = undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      const method = init?.method ?? 'GET'
      if (url.endsWith('/gists') && method === 'POST') {
        const body = JSON.parse(init?.body as string)
        remote = parseGistDocument(body.files[GIST_SYNC_FILE_NAME].content)
        return response({ id: 'gist-1', html_url: 'https://gist.github.com/example/gist-1' }, 201)
      }
      if (url.endsWith('/gists/gist-1') && method === 'PATCH') {
        const body = JSON.parse(init?.body as string)
        if (keepParentVisibleAfterNextPatch) staleRemote = remote
        keepParentVisibleAfterNextPatch = false
        remote = parseGistDocument(body.files[GIST_SYNC_FILE_NAME].content)
        const patched = remote
        if (afterNextPatch) remote = afterNextPatch(patched)
        afterNextPatch = undefined
        return response(gistResponse(patched))
      }
      if (url.endsWith('/gists/gist-1')) {
        const beforeRead = beforeNextRead
        beforeNextRead = undefined
        await beforeRead?.()
        const visible = staleRemote ?? remote!
        staleRemote = undefined
        return response(gistResponse(visible))
      }
      throw new Error(`Unexpected request ${url}`)
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('creates a v2 Gist, uploads local changes, and keeps the token out of public state', async () => {
    const connected = await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    expect(connected).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(JSON.stringify(connected)).not.toContain('private-token')

    await bookmarkRepository.createBookmark({ title: 'Vite', url: 'https://vite.dev', tagIds: [], newTagNames: ['开发'] })
    const synced = await service.handle({ type: 'gist-sync:sync-now' })
    expect(synced).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(remote?.sync.protocolVersion).toBe(2)
    expect(remote?.data.bookmarks[0]?.title).toBe('Vite')
  })

  it('keeps a successful PATCH pending and uploads local changes made while waiting', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const parent = remote!
    await bookmarkRepository.createBookmark({
      title: '延迟可见',
      url: 'https://eventual.example/',
      tagIds: [],
      newTagNames: [],
    })
    keepParentVisibleAfterNextPatch = true

    const result = await service.handle({ type: 'gist-sync:sync-now' })
    const stored = getLocalStore()[GIST_SYNC_STORAGE_KEY] as {
      baseline: { revisionId: string }
      conflict?: unknown
      pendingWrite?: { parentRevisionId: string }
      status: string
    }

    expect(result).toMatchObject({ ok: true, state: { status: 'syncing' } })
    expect(stored.baseline.revisionId).toBe(remote?.sync.revisionId)
    expect(stored.conflict).toBeUndefined()
    expect(stored.pendingWrite?.parentRevisionId).toBe(remote?.sync.parentRevisionId)
    expect(stored.status).toBe('syncing')

    await bookmarkRepository.createBookmark({
      title: '等待确认期间新增',
      url: 'https://pending-change.example/',
      tagIds: [],
      newTagNames: [],
    })

    staleRemote = parent
    const waiting = await service.handle({ type: 'gist-sync:sync-now' })
    const stillPending = getLocalStore()[GIST_SYNC_STORAGE_KEY] as {
      pendingWrite?: unknown
      status: string
    }
    expect(waiting).toMatchObject({ ok: true, state: { status: 'syncing' } })
    expect(stillPending.status).toBe('syncing')
    expect(stillPending.pendingWrite).toBeDefined()

    const confirmedResult = await service.handle({ type: 'gist-sync:sync-now' })
    const confirmed = getLocalStore()[GIST_SYNC_STORAGE_KEY] as { pendingWrite?: unknown }
    expect(confirmedResult).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(confirmed.pendingWrite).toBeUndefined()
    expect(remote?.data.bookmarks.map((bookmark) => bookmark.title)).toEqual(expect.arrayContaining([
      '延迟可见',
      '等待确认期间新增',
    ]))
  })

  it('merges a concurrent write hidden by a stale parent GET', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const connected = getLocalStore()[GIST_SYNC_STORAGE_KEY] as {
      baseline: { revisionId: string; snapshot: GistSyncDocument['data'] }
    }
    await bookmarkRepository.createBookmark({
      title: '本机待确认',
      url: 'https://pending-local.example/',
      tagIds: [],
      newTagNames: [],
    })
    keepParentVisibleAfterNextPatch = true
    afterNextPatch = () => createGistDocument({
      ...connected.baseline.snapshot,
      bookmarks: [...connected.baseline.snapshot.bookmarks, {
        id: 'hidden-concurrent-bookmark',
        tagIds: [],
        title: '远端并发写入',
        url: 'https://hidden-concurrent.example/',
        createdAt: 10,
        updatedAt: 10,
      }],
    }, connected.baseline.revisionId)

    const pending = await service.handle({ type: 'gist-sync:sync-now' })
    expect(pending).toMatchObject({ ok: true, state: { status: 'syncing' } })

    // 模拟 service worker 在下一次同步前被浏览器回收，待确认信息必须能从 storage 恢复。
    service = new GistSyncService()
    const result = await service.handle({ type: 'gist-sync:sync-now' })
    const local = await bookmarkRepository.load()
    const stored = getLocalStore()[GIST_SYNC_STORAGE_KEY] as { pendingWrite?: unknown }

    expect(result).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(local.bookmarks.map((bookmark) => bookmark.title)).toEqual(expect.arrayContaining([
      '本机待确认',
      '远端并发写入',
    ]))
    expect(remote?.data.bookmarks.map((bookmark) => bookmark.title)).toEqual(expect.arrayContaining([
      '本机待确认',
      '远端并发写入',
    ]))
    expect(stored.pendingWrite).toBeUndefined()
  })

  it('still reports a conflict when the GET observes a third revision after PATCH', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    await bookmarkRepository.createBookmark({
      title: '本机写入',
      url: 'https://local-write.example/',
      tagIds: [],
      newTagNames: [],
    })
    afterNextPatch = (patched) => ({
      ...patched,
      data: {
        ...patched.data,
        bookmarks: [...patched.data.bookmarks, {
          id: 'concurrent-bookmark',
          tagIds: [],
          title: '并发写入',
          url: 'https://concurrent-write.example/',
          createdAt: 10,
          updatedAt: 10,
        }],
      },
      sync: {
        ...patched.sync,
        revisionId: 'concurrent-revision',
        parentRevisionId: patched.sync.revisionId,
      },
    })

    const result = await service.handle({ type: 'gist-sync:sync-now' })

    expect(result).toMatchObject({
      ok: true,
      state: { status: 'conflict', conflictCount: 1 },
    })
  })

  it('repairs a persisted false write conflict after the remote update becomes visible', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const connected = getLocalStore()[GIST_SYNC_STORAGE_KEY] as {
      credentials: unknown
      baseline: { revisionId: string; snapshot: GistSyncDocument['data'] }
      status: string
    }
    await bookmarkRepository.createBookmark({
      title: '已写入远端',
      url: 'https://recovered.example/',
      tagIds: [],
      newTagNames: [],
    })
    const local = await bookmarkRepository.load()
    remote = createGistDocument(local, connected.baseline.revisionId)
    await chrome.storage.local.set({
      [GIST_SYNC_STORAGE_KEY]: {
        ...connected,
        status: 'conflict',
        conflict: {
          base: connected.baseline.snapshot,
          local,
          remote: connected.baseline.snapshot,
          remoteRevisionId: connected.baseline.revisionId,
          conflicts: ['Gist 在写入后被其他设备更新，请选择冲突来源。'],
        },
      },
    })

    const result = await service.handle({ type: 'gist-sync:sync-now' })
    const stored = getLocalStore()[GIST_SYNC_STORAGE_KEY] as {
      baseline: { revisionId: string }
      conflict?: unknown
    }

    expect(result).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(stored.baseline.revisionId).toBe(remote.sync.revisionId)
    expect(stored.conflict).toBeUndefined()
  })

  it('keeps a persisted conflict when local data changed after the false report', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const connected = getLocalStore()[GIST_SYNC_STORAGE_KEY] as {
      credentials: unknown
      baseline: { revisionId: string; snapshot: GistSyncDocument['data'] }
      status: string
    }
    await bookmarkRepository.createBookmark({
      title: '冲突本机侧',
      url: 'https://conflict-local.example/',
      tagIds: [],
      newTagNames: [],
    })
    const conflictLocal = await bookmarkRepository.load()
    remote = createGistDocument(conflictLocal, connected.baseline.revisionId)
    await chrome.storage.local.set({
      [GIST_SYNC_STORAGE_KEY]: {
        ...connected,
        status: 'conflict',
        conflict: {
          base: connected.baseline.snapshot,
          local: conflictLocal,
          remote: connected.baseline.snapshot,
          remoteRevisionId: connected.baseline.revisionId,
          conflicts: ['Gist 在写入后被其他设备更新，请选择冲突来源。'],
        },
      },
    })
    await bookmarkRepository.createBookmark({
      title: '冲突后新增',
      url: 'https://after-conflict.example/',
      tagIds: [],
      newTagNames: [],
    })

    const result = await service.handle({ type: 'gist-sync:sync-now' })

    expect(result).toMatchObject({ ok: true, state: { status: 'conflict' } })
  })

  it('does not upload or report a conflict when old v2 tags omit pinned', async () => {
    installChromeMock({
      'linkdeck:v2:meta': { schemaVersion: 2, tags: [] },
      'linkdeck:v2:tag:work': { id: 'work', name: '工作', createdAt: 1, updatedAt: 1 },
    })
    service = new GistSyncService()

    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    vi.mocked(fetch).mockClear()

    const result = await service.handle({ type: 'gist-sync:sync-now' })

    expect(result).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBeUndefined()
  })

  it('stops on a true concurrent tag rename conflict', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const localTag = await bookmarkRepository.createTag('本机工作')
    remote = {
      ...remote!,
      data: {
        ...remote!.data,
        meta: { schemaVersion: 2, tags: [{ ...localTag, name: '远端工作' }] },
      },
      sync: { ...remote!.sync, revisionId: 'remote-change' },
    }
    const result = await service.handle({ type: 'gist-sync:sync-now' })
    expect(result).toMatchObject({ ok: true, state: { status: 'conflict', conflictCount: 1 } })
    const retried = await service.handle({ type: 'gist-sync:sync-now' })
    expect(retried).toMatchObject({ ok: true, state: { status: 'conflict', conflictCount: 1 } })
  })

  it('keeps local changes made while the remote snapshot is loading', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    remote = {
      ...remote!,
      data: {
        ...remote!.data,
        bookmarks: [{ id: 'remote-bookmark', tagIds: [], title: '远端新增', url: 'https://remote.example/', createdAt: 2, updatedAt: 2 }],
      },
      sync: { ...remote!.sync, revisionId: 'remote-addition' },
    }
    beforeNextRead = async () => {
      await bookmarkRepository.createBookmark({ title: '本机新增', url: 'https://local.example/', tagIds: [], newTagNames: [] })
    }

    const result = await service.handle({ type: 'gist-sync:sync-now' })
    const synced = await bookmarkRepository.load()
    expect(result).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(synced.bookmarks.map((bookmark) => bookmark.title)).toEqual(expect.arrayContaining(['本机新增', '远端新增']))
    expect(remote?.data.bookmarks.map((bookmark) => bookmark.title)).toEqual(expect.arrayContaining(['本机新增', '远端新增']))
  })

  it('migrates a stored v1 baseline and upgrades the remote document to v2', async () => {
    const legacySnapshot = {
      meta: { schemaVersion: 1, groups: [{ id: 'work', name: '工作', createdAt: 1, updatedAt: 1 }] },
      bookmarks: [{ id: 'github', groupId: 'work', title: 'GitHub', url: 'https://github.com/', createdAt: 2, updatedAt: 2 }],
    }
    const legacyDocument = {
      app: 'LinkDeck',
      formatVersion: 1,
      exportedAt: '2026-08-10T00:00:00.000Z',
      data: legacySnapshot,
      sync: { protocolVersion: 1, revisionId: 'legacy-revision', parentRevisionId: null, writtenAt: '2026-08-10T00:00:00.000Z' },
    }
    remote = legacyDocument as unknown as GistSyncDocument
    await bookmarkRepository.importSnapshot({
      meta: { schemaVersion: 2, tags: [{ id: 'work', name: '工作', pinned: false, createdAt: 1, updatedAt: 1 }] },
      bookmarks: [{ id: 'github', tagIds: ['work'], title: 'GitHub', url: 'https://github.com/', createdAt: 2, updatedAt: 2 }],
    }, 'replace')
    await chrome.storage.local.set({
      [GIST_SYNC_STORAGE_KEY]: {
        credentials: { token: 'private-token', gistId: 'gist-1', gistUrl: 'https://gist.github.com/example/gist-1' },
        baseline: { revisionId: 'legacy-revision', snapshot: legacySnapshot },
        status: 'synced',
      },
    })

    const result = await service.handle({ type: 'gist-sync:sync-now' })
    expect(result).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(remote?.sync.protocolVersion).toBe(2)
    const stored = getLocalStore()[GIST_SYNC_STORAGE_KEY] as { baseline: { snapshot: { meta: { schemaVersion: number } } } }
    expect(stored.baseline.snapshot.meta.schemaVersion).toBe(2)
  })
})
