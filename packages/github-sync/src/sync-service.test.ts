import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionSnapshot } from '@linkdeck/bookmarks'
import { bookmarkRepository } from '@linkdeck/bookmarks/repository'
import { parseBackupJson, serializeBackup } from '@linkdeck/data-transfer'
import { getLocalStore, installChromeMock } from '@linkdeck/test-utils'
import { GitHubSyncService } from './sync-service'
import { GITHUB_SYNC_STORAGE_KEY, type BindingMode, type StoredGitHubSyncState } from './types'

const binding = { token: 'test-private-token', repositoryInput: 'https://github.com/example/bookmarks' }
const metadata = { id: 42, full_name: 'example/bookmarks', default_branch: 'main', private: true, visibility: 'private' }
const filePath = '/repos/example/bookmarks/contents/linkdeck-sync.json'

function bookmark(title: string) {
  return { id: title, title, url: 'https://example.org/' + encodeURIComponent(title), tagIds: [], createdAt: 1, updatedAt: 1 }
}

function addBookmark(title: string) {
  return bookmarkRepository.createBookmark({ ...bookmark(title), newTagNames: [] })
}

function titles(snapshot: CollectionSnapshot | undefined) {
  return snapshot?.bookmarks.map(({ title }) => title).sort()
}

describe('GitHubSyncService', () => {
  let service: GitHubSyncService
  let remote: CollectionSnapshot | undefined
  let revision: number
  let repository: typeof metadata
  let beforeWrite: (() => void | Promise<void>) | undefined
  let afterRead: (() => void) | undefined
  let writeStatus: number | undefined
  let rejectionStatus: 409 | 422
  let writes: { branch?: string; sha?: string }[]
  let fetchMock: ReturnType<typeof vi.fn>
  const getStored = () => getLocalStore()[GITHUB_SYNC_STORAGE_KEY] as StoredGitHubSyncState
  const sync = () => service.handle({ type: 'github-sync:sync-now' })
  const preview = async () => (await service.handle({ type: 'github-sync:preview', ...binding })).preview!
  const confirm = (version: string, mode: BindingMode = 'local') =>
    service.handle({ type: 'github-sync:confirm-bind', ...binding, version, mode })
  const bind = async (mode: BindingMode = 'local') => confirm((await preview()).version, mode)
  const resolve = (choice: 'local' | 'remote') => service.handle({ type: 'github-sync:resolve-conflict', choice })

  beforeEach(() => {
    installChromeMock()
    service = new GitHubSyncService()
    remote = undefined
    revision = 1
    repository = { ...metadata }
    beforeWrite = undefined
    afterRead = undefined
    writeStatus = undefined
    rejectionStatus = 409
    writes = []
    fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      const { pathname, searchParams } = new URL(input)
      if (pathname === '/repos/example/bookmarks') return Response.json(repository)
      expect(pathname).toBe(filePath)
      if (init.method !== 'PUT') {
        expect(searchParams.get('ref')).toBe('main')
        const response = remote
          ? Response.json({
            type: 'file', encoding: 'base64', sha: String(revision),
            content: Buffer.from(serializeBackup(remote)).toString('base64'),
          })
          : Response.json({ message: 'Not Found' }, { status: 404 })
        afterRead?.()
        return response
      }

      const body = JSON.parse(init.body as string)
      writes.push({ branch: body.branch, sha: body.sha })
      const concurrent = beforeWrite
      beforeWrite = undefined
      await concurrent?.()
      if (writeStatus) return Response.json({}, { status: writeStatus })
      if (body.sha !== (remote ? String(revision) : undefined)) {
        return Response.json({}, { status: rejectionStatus })
      }
      const status = remote ? 200 : 201
      remote = parseBackupJson(Buffer.from(body.content, 'base64').toString('utf8')).data
      revision += 1
      return Response.json({}, { status })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('does not contact GitHub while disconnected, and initializes only after confirmation', async () => {
    expect(await sync()).toEqual({ ok: true, state: { status: 'disconnected' } })
    expect(fetchMock).not.toHaveBeenCalled()
    await addBookmark('资料 📚')
    const pending = await preview()
    expect(pending).toMatchObject({ remote: null, local: { bookmarks: 1 } })
    expect(writes).toHaveLength(0)
    expect(getStored()).toBeUndefined()

    const connected = await confirm(pending.version)
    expect(connected).toMatchObject({ ok: true, state: { status: 'synced', repositoryUrl: 'https://github.com/example/bookmarks' } })
    expect(JSON.stringify(connected)).not.toContain(binding.token)
    expect(writes).toEqual([{ branch: undefined, sha: undefined }])
    expect(titles(remote)).toEqual(['资料 📚'])
    expect(getStored().credentials.token).toBe(binding.token)
    expect(JSON.stringify(await chrome.storage.sync.get(null))).not.toContain(binding.token)
    await sync()
    expect(writes).toHaveLength(1)
  })

  it.each([
    { mode: 'remote', expected: ['远端'] },
    { mode: 'local', expected: ['本机'] },
    { mode: 'merge', expected: ['本机', '远端'] },
  ] as const)('binds existing data in $mode mode', async ({ mode, expected }) => {
    await addBookmark('本机')
    remote = { ...await bookmarkRepository.load(), bookmarks: [bookmark('远端')] }
    expect(await bind(mode)).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(titles(remote)).toEqual(expected)
    expect(titles(await bookmarkRepository.load())).toEqual(expected)
    expect(writes).toHaveLength(mode === 'remote' ? 0 : 1)
  })

  it('refreshes a stale preview without overwriting the remote file', async () => {
    const pending = await preview()
    remote = { ...await bookmarkRepository.load(), bookmarks: [bookmark('远端')] }
    const refreshed = await confirm(pending.version)
    expect(refreshed).toMatchObject({ ok: true, error: expect.stringContaining('重新确认'), preview: { remote: { bookmarks: 1 } } })
    expect(writes).toHaveLength(0)
    expect(getStored()).toBeUndefined()
  })

  it('refreshes the preview if another browser initializes the file during confirmation', async () => {
    const pending = await preview()
    const local = await bookmarkRepository.load()
    rejectionStatus = 422
    beforeWrite = () => { remote = { ...local, bookmarks: [bookmark('并发初始化')] } }
    expect(await confirm(pending.version)).toMatchObject({ ok: true, preview: { remote: { bookmarks: 1 } } })
    expect(titles(remote)).toEqual(['并发初始化'])
    expect(writes).toHaveLength(1)
    expect(getStored()).toBeUndefined()
  })

  it('retries a stale SHA once and merges independent changes after a worker restart', async () => {
    await bind()
    service = new GitHubSyncService()
    await addBookmark('本机')
    beforeWrite = () => {
      remote = { ...remote!, bookmarks: [bookmark('并发远端')] }
      revision += 1
    }
    expect(await sync()).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(writes.slice(1)).toEqual([{ branch: 'main', sha: '2' }, { branch: 'main', sha: '3' }])
    expect(titles(remote)).toEqual(['并发远端', '本机'])
    expect(titles(await bookmarkRepository.load())).toEqual(titles(remote))
  })

  it.each(['local', 'remote'] as const)('syncs a tag deleted only on the %s side without a conflict', async (side) => {
    const tag = await bookmarkRepository.createTag('工作')
    const { bookmark: shared } = await bookmarkRepository.createBookmark({
      ...bookmark('共同收藏'), tagIds: [tag.id], newTagNames: [],
    })
    await bind()

    if (side === 'local') {
      await bookmarkRepository.deleteTag(tag.id)
    } else {
      remote = {
        meta: { schemaVersion: 2, tags: [] },
        bookmarks: [{ ...shared, tagIds: [], updatedAt: shared.updatedAt + 1 }],
      }
      revision += 1
    }

    expect(await sync()).toMatchObject({ ok: true, state: { status: 'synced' } })
    const local = await bookmarkRepository.load()
    expect(local.meta.tags).toEqual([])
    expect(local.bookmarks).toHaveLength(1)
    expect(local.bookmarks[0]).toMatchObject({ id: shared.id, title: shared.title, url: shared.url, tagIds: [] })
    expect(remote).toEqual(local)
    expect(getStored().baseline).toEqual(local)
    expect(getStored().conflict).toBeUndefined()
    expect(writes).toHaveLength(side === 'local' ? 2 : 1)

    await addBookmark('后续新增')
    expect(await sync()).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(titles(remote)).toEqual(['共同收藏', '后续新增'])
  })

  it('refreshes the conflict if the remote changes again before applying a choice', async () => {
    const { bookmark: shared } = await addBookmark('共同收藏')
    await bind()
    await bookmarkRepository.updateBookmark(shared.id, { ...shared, title: '本机编辑', newTagNames: [] })
    remote = { ...remote!, bookmarks: [{ ...shared, title: '远端编辑' }] }
    revision += 1
    expect(await sync()).toMatchObject({ ok: true, state: { status: 'conflict', conflictCount: 1 } })
    expect(writes).toHaveLength(1)

    beforeWrite = () => {
      remote = { ...remote!, bookmarks: [{ ...shared, title: '远端再次编辑' }, bookmark('独立新增')] }
      revision += 1
    }
    expect(await resolve('local')).toMatchObject({ state: { status: 'conflict', error: expect.stringContaining('重新选择') } })
    expect(titles(await bookmarkRepository.load())).toEqual(['本机编辑'])
    expect(await resolve('remote')).toMatchObject({ state: { status: 'synced' } })
    expect(titles(await bookmarkRepository.load())).toEqual(['独立新增', '远端再次编辑'])
  })

  it('preserves a bookmark changed locally during a remote write', async () => {
    await bind()
    await addBookmark('本机')
    remote = { ...remote!, bookmarks: [bookmark('远端')] }
    revision += 1
    beforeWrite = async () => { await addBookmark('写入期间新增') }

    expect(await sync()).toMatchObject({ ok: false, state: { status: 'error' } })
    expect(titles(getStored().baseline)).toEqual([])
    expect(titles(await bookmarkRepository.load())).toEqual(['写入期间新增', '本机'])
    expect(await sync()).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(titles(remote)).toEqual(['写入期间新增', '本机', '远端'])
  })

  it.each(['public', 'replaced', 'missing', 'forbidden'] as const)(
    'preserves the baseline and local data on a %s repository failure',
    async (failure) => {
      await bind()
      const baseline = getStored().baseline
      await addBookmark('本机')
      if (failure === 'public') repository = { ...metadata, visibility: 'public', private: false }
      if (failure === 'replaced') repository = { ...metadata, id: 777 }
      if (failure === 'missing') remote = undefined
      if (failure === 'forbidden') writeStatus = 403

      expect(await sync()).toMatchObject({ ok: false, state: { status: 'error' } })
      expect(getStored().baseline).toEqual(baseline)
      expect(titles(await bookmarkRepository.load())).toEqual(['本机'])
      expect(writes).toHaveLength(failure === 'forbidden' ? 2 : 1)
    },
  )

  it('rechecks visibility before publishing and can disconnect after an error', async () => {
    await bind()
    await addBookmark('本机')
    afterRead = () => { repository = { ...metadata, visibility: 'public', private: false } }

    expect(await sync()).toMatchObject({ ok: false, state: { status: 'error' } })
    expect(writes).toHaveLength(1)
    expect(await service.handle({ type: 'github-sync:disconnect' })).toEqual({ ok: true, state: { status: 'disconnected' } })
    expect(getStored()).toBeUndefined()
    expect(titles(remote)).toEqual([])
    expect(titles(await bookmarkRepository.load())).toEqual(['本机'])
  })
})
