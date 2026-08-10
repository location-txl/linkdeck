import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bookmarkRepository } from '../lib/bookmark-repository'
import { installChromeMock } from '../test/chrome'
import { parseGistDocument, serializeGistDocument } from './gist-api'
import { GistSyncService } from './gist-sync'
import type { GistSyncDocument } from './types'
import { GIST_SYNC_FILE_NAME } from './types'

function response(value: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => value } as Response
}

describe('GistSyncService', () => {
  let service: GistSyncService
  let remote: GistSyncDocument | undefined
  let beforeNextRead: (() => Promise<void>) | undefined

  beforeEach(() => {
    installChromeMock()
    service = new GistSyncService()
    remote = undefined
    beforeNextRead = undefined
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
        remote = parseGistDocument(body.files[GIST_SYNC_FILE_NAME].content)
        return response({})
      }
      if (url.endsWith('/gists/gist-1')) {
        const beforeRead = beforeNextRead
        beforeNextRead = undefined
        await beforeRead?.()
        return response({
          id: 'gist-1',
          html_url: 'https://gist.github.com/example/gist-1',
          files: { [GIST_SYNC_FILE_NAME]: { content: serializeGistDocument(remote!), truncated: false } },
        })
      }
      throw new Error(`Unexpected request ${url}`)
    }))
  })

  it('creates a Gist, uploads local changes, and keeps the token out of public state', async () => {
    const connected = await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    expect(connected).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(JSON.stringify(connected)).not.toContain('private-token')

    const initial = await bookmarkRepository.load()
    await bookmarkRepository.createBookmark({
      groupId: initial.meta.groups[0]!.id,
      title: 'Vite',
      url: 'https://vite.dev',
    })
    const synced = await service.handle({ type: 'gist-sync:sync-now' })

    expect(synced).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(remote?.data.bookmarks[0]?.title).toBe('Vite')
  })

  it('stops on a true conflict instead of overwriting either side', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const local = await bookmarkRepository.load()
    await bookmarkRepository.renameGroup(local.meta.groups[0]!.id, '本机工作')

    remote = {
      ...remote!,
      data: {
        ...remote!.data,
        meta: {
          ...remote!.data.meta,
          groups: remote!.data.meta.groups.map((group) => ({ ...group, name: '远端工作' })),
        },
      },
      sync: {
        ...remote!.sync,
        revisionId: 'remote-change',
      },
    }
    const result = await service.handle({ type: 'gist-sync:sync-now' })

    expect(result).toMatchObject({ ok: true, state: { status: 'conflict', conflictCount: 1 } })
  })

  it('keeps local changes made while the remote snapshot is loading', async () => {
    await service.handle({ type: 'gist-sync:connect', token: 'private-token' })
    const local = await bookmarkRepository.load()
    const groupId = local.meta.groups[0]!.id
    remote = {
      ...remote!,
      data: {
        ...remote!.data,
        bookmarks: [{
          id: 'remote-bookmark',
          groupId,
          title: '远端新增',
          url: 'https://remote.example/',
          createdAt: 2,
          updatedAt: 2,
        }],
      },
      sync: {
        ...remote!.sync,
        revisionId: 'remote-addition',
      },
    }
    beforeNextRead = async () => {
      await bookmarkRepository.createBookmark({
        groupId,
        title: '本机新增',
        url: 'https://local.example/',
      })
    }

    const result = await service.handle({ type: 'gist-sync:sync-now' })
    const synced = await bookmarkRepository.load()

    expect(result).toMatchObject({ ok: true, state: { status: 'synced' } })
    expect(synced.bookmarks.map((bookmark) => bookmark.title)).toEqual(
      expect.arrayContaining(['本机新增', '远端新增']),
    )
    expect(remote?.data.bookmarks.map((bookmark) => bookmark.title)).toEqual(
      expect.arrayContaining(['本机新增', '远端新增']),
    )
  })
})
