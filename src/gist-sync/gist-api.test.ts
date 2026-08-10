import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionSnapshot } from '../types'
import {
  GistApiError,
  createGist,
  createGistDocument,
  parseGistDocument,
  parseGistId,
  readGist,
  serializeGistDocument,
} from './gist-api'
import { GIST_SYNC_FILE_NAME } from './types'

const snapshot: CollectionSnapshot = {
  meta: { schemaVersion: 2, tags: [{ id: 'work', name: '工作', createdAt: 1, updatedAt: 2 }] },
  bookmarks: [{
    id: 'github',
    tagIds: ['work'],
    title: 'GitHub',
    url: 'https://github.com/',
    createdAt: 3,
    updatedAt: 4,
  }],
}

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gist API', () => {
  it('creates a secret Gist with the LinkDeck sync document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'abc123',
      html_url: 'https://gist.github.com/example/abc123',
    }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const created = await createGist('token-value', snapshot)

    expect(created.id).toBe('abc123')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/gists',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-value',
          'X-GitHub-Api-Version': '2026-03-10',
        }),
      }),
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(request.body as string)
    expect(body.public).toBe(false)
    expect(parseGistDocument(body.files[GIST_SYNC_FILE_NAME].content).data).toEqual(snapshot)
    expect(parseGistDocument(body.files[GIST_SYNC_FILE_NAME].content).sync.protocolVersion).toBe(2)
  })

  it('accepts and upgrades a legacy v1 document in memory', () => {
    const legacy = JSON.stringify({
      app: 'LinkDeck', formatVersion: 1, exportedAt: '2026-08-09T08:00:00.000Z',
      data: {
        meta: { schemaVersion: 1, groups: [{ id: 'work', name: '工作', createdAt: 1, updatedAt: 2 }] },
        bookmarks: [{ id: 'github', groupId: 'work', title: 'GitHub', url: 'https://github.com/', createdAt: 3, updatedAt: 4 }],
      },
      sync: { protocolVersion: 1, revisionId: 'legacy', parentRevisionId: null, writtenAt: '2026-08-09T08:00:00.000Z' },
    })
    expect(parseGistDocument(legacy)).toMatchObject({
      sync: { protocolVersion: 1 },
      data: { meta: { schemaVersion: 2, tags: [{ id: 'work' }] }, bookmarks: [{ tagIds: ['work'] }] },
    })
  })

  it('reads the configured file and rejects incomplete Gists', async () => {
    const document = createGistDocument(snapshot, 'parent')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'abc123',
      html_url: 'https://gist.github.com/example/abc123',
      files: {
        [GIST_SYNC_FILE_NAME]: { content: serializeGistDocument(document), truncated: false },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(readGist('token', 'abc123')).resolves.toMatchObject({
      id: 'abc123',
      document: { sync: { parentRevisionId: 'parent' } },
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'abc123',
      html_url: 'https://gist.github.com/example/abc123',
      files: {},
    }))
    await expect(readGist('token', 'abc123')).rejects.toThrow(`缺少 ${GIST_SYNC_FILE_NAME}`)
  })

  it('surfaces GitHub authorization and rate-limit failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 403))
    vi.stubGlobal('fetch', fetchMock)
    await expect(readGist('token', 'abc123')).rejects.toBeInstanceOf(GistApiError)
    try {
      await readGist('token', 'abc123')
    } catch (error) {
      expect((error as GistApiError).status).toBe(403)
    }

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 429))
    await expect(readGist('token', 'abc123')).rejects.toThrow('请求过于频繁')
  })

  it('accepts a Gist URL or an ID', () => {
    expect(parseGistId('https://gist.github.com/example/abc123')).toBe('abc123')
    expect(parseGistId('abc123')).toBe('abc123')
    expect(() => parseGistId('https://example.com/not-a-gist')).toThrow('格式不正确')
  })
})
