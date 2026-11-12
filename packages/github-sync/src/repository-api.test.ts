import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRepositoryName, readRepository, readRepositoryFile } from './repository-api'

const repository = { id: 42, fullName: 'owner/repo', branch: 'bookmarks/v2' }
const metadata = { id: 42, full_name: 'owner/repo', default_branch: repository.branch, private: true, visibility: 'private' }

afterEach(() => vi.unstubAllGlobals())

describe('GitHub repository API', () => {
  it.each(['owner/repo', 'https://github.com/owner/repo/', 'https://github.com/owner/repo.git'])('accepts %s', (input) => {
    expect(parseRepositoryName(input)).toBe('owner/repo')
  })

  it.each(['owner/..', 'https://example.com/owner/repo', 'https://github.com/owner/repo/issues', 'owner/repo?ref=main'])(
    'rejects %s',
    (input) => expect(() => parseRepositoryName(input)).toThrow('请输入 owner/repo'),
  )

  it.each(['public', 'internal'])('rejects a %s repository without reading its contents', async (visibility) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...metadata, visibility }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(readRepository('token', repository.fullName)).rejects.toThrow('只支持 GitHub 私有仓库')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reads the pinned branch and rejects a malformed backup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      type: 'file', sha: 'abc123', encoding: 'base64', content: btoa('{}'),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(readRepositoryFile({ token: 'test-token', repository })).rejects.toThrow('LinkDeck 备份')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/contents/linkdeck-sync.json?ref=bookmarks%2Fv2',
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })
})
