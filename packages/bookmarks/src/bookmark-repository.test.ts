import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookmarkRepository } from './bookmark-repository'
import { STORAGE_KEYS, type CollectionSnapshot } from './types'
import { getLocalStore, getSyncStore, installChromeMock } from '@linkdeck/test-utils'

function snapshot(): CollectionSnapshot {
  return {
    meta: { schemaVersion: 2, tags: [{ id: 'work', name: '工作', pinned: false, createdAt: 1, updatedAt: 1 }] },
    bookmarks: [{ id: 'github', tagIds: ['work'], title: 'GitHub', url: 'https://github.com/', createdAt: 2, updatedAt: 2 }],
  }
}

describe('BookmarkRepository', () => {
  let repository: BookmarkRepository

  beforeEach(() => {
    installChromeMock()
    repository = new BookmarkRepository()
  })

  it('initializes without a default tag and permits untagged bookmarks', async () => {
    const first = await repository.load()
    expect(first.meta.tags).toEqual([])

    const result = await repository.createBookmark({ title: 'GitHub', url: 'github.com', tagIds: [], newTagNames: [] })
    expect(result.created).toBe(true)
    expect((await repository.load()).bookmarks[0]).toMatchObject({ title: 'GitHub', tagIds: [] })
  })

  it('normalizes old tags and persists pin changes', async () => {
    installChromeMock({
      [STORAGE_KEYS.meta]: { schemaVersion: 2, tags: [] },
      [`${STORAGE_KEYS.tagPrefix}work`]: { id: 'work', name: '工作', createdAt: 1, updatedAt: 1 },
    })
    repository = new BookmarkRepository()
    expect((await repository.load()).meta.tags[0]).toMatchObject({ id: 'work', pinned: false })

    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(10)
    await repository.setTagPinned('work', true)
    expect((await repository.load()).meta.tags[0]).toMatchObject({ pinned: true, updatedAt: 10 })
    await repository.setTagPinned('work', false)
    expect((await repository.load()).meta.tags[0]).toMatchObject({ pinned: false, updatedAt: 10 })
    dateNow.mockRestore()

    await expect(repository.setTagPinned('missing', true)).rejects.toThrow('找不到这个标签')
  })

  it('serializes a pending rename and pin change without losing either field', async () => {
    const work = await repository.createTag('工作')
    const originalSet = vi.mocked(chrome.storage.sync.set).getMockImplementation()!
    let releaseWrite: () => void
    const allowWrite = new Promise<void>((resolve) => { releaseWrite = resolve })
    let markWriteStarted: () => void
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    vi.mocked(chrome.storage.sync.set).mockImplementation(async (...args) => {
      const items = args[0] as Record<string, unknown>
      const tag = items[`${STORAGE_KEYS.tagPrefix}${work.id}`] as { name?: string } | undefined
      if (tag?.name === '常用工作') {
        markWriteStarted()
        await allowWrite
      }
      return originalSet(...args)
    })

    const rename = repository.renameTag(work.id, '常用工作')
    await writeStarted
    const pin = repository.setTagPinned(work.id, true)
    releaseWrite!()
    await Promise.all([rename, pin])

    expect((await repository.load()).meta.tags.find((tag) => tag.id === work.id))
      .toMatchObject({ name: '常用工作', pinned: true })
  })

  it('does not resurrect a tag when a queued pin runs after deletion', async () => {
    const work = await repository.createTag('工作')
    const originalRemove = vi.mocked(chrome.storage.sync.remove).getMockImplementation()!
    let releaseRemoval: () => void
    const allowRemoval = new Promise<void>((resolve) => { releaseRemoval = resolve })
    let markRemovalStarted: () => void
    const removalStarted = new Promise<void>((resolve) => { markRemovalStarted = resolve })
    vi.mocked(chrome.storage.sync.remove).mockImplementation(async (...args) => {
      const keys = args[0] as string | string[]
      if ((Array.isArray(keys) ? keys : [keys]).includes(`${STORAGE_KEYS.tagPrefix}${work.id}`)) {
        markRemovalStarted()
        await allowRemoval
      }
      return originalRemove(...args)
    })

    const deletion = repository.deleteTag(work.id)
    await removalStarted
    const pin = repository.setTagPinned(work.id, true)
    releaseRemoval!()
    await deletion
    await expect(pin).rejects.toThrow('找不到这个标签')

    expect((await repository.load()).meta.tags.find((tag) => tag.id === work.id)).toBeUndefined()
  })

  it('serializes snapshot replacement with a concurrent pin across repository instances', async () => {
    await repository.importSnapshot(snapshot(), 'replace')
    const otherRepository = new BookmarkRepository()
    const expected = await repository.load()
    const replacement: CollectionSnapshot = {
      meta: {
        schemaVersion: 2,
        tags: expected.meta.tags.map((tag) => ({ ...tag, name: '远端工作', pinned: false })),
      },
      bookmarks: expected.bookmarks,
    }
    const originalSet = vi.mocked(chrome.storage.sync.set).getMockImplementation()!
    let releaseReplacement: () => void
    const replacementAllowed = new Promise<void>((resolve) => { releaseReplacement = resolve })
    let markReplacementStarted: () => void
    const replacementStarted = new Promise<void>((resolve) => { markReplacementStarted = resolve })
    vi.mocked(chrome.storage.sync.set).mockImplementation(async (...args) => {
      const items = args[0] as Record<string, unknown>
      const tag = items[`${STORAGE_KEYS.tagPrefix}work`] as { name?: string } | undefined
      if (tag?.name === '远端工作') {
        markReplacementStarted()
        await replacementAllowed
      }
      return originalSet(...args)
    })

    const replace = repository.importSnapshot(replacement, 'replace', expected)
    await replacementStarted
    let pinSettled = false
    const pin = otherRepository.setTagPinned('work', true).then(() => {
      pinSettled = true
    })
    try {
      await Promise.resolve()
      expect(pinSettled).toBe(false)
    } finally {
      releaseReplacement!()
    }

    await Promise.all([replace, pin])
    expect((await repository.load()).meta.tags[0]).toMatchObject({ name: '远端工作', pinned: true })
  })

  it('rejects a replacement based on a stale snapshot after a local pin change', async () => {
    await repository.importSnapshot(snapshot(), 'replace')
    const expected = await repository.load()
    await repository.setTagPinned('work', true)
    const replacement: CollectionSnapshot = {
      meta: {
        schemaVersion: 2,
        tags: expected.meta.tags.map((tag) => ({ ...tag, name: '远端工作', pinned: false })),
      },
      bookmarks: expected.bookmarks,
    }

    await expect(repository.importSnapshot(replacement, 'replace', expected))
      .rejects.toThrow('数据在替换期间发生变化')
    expect((await repository.load()).meta.tags[0]).toMatchObject({ pinned: true })
  })

  it('migrates v1 groups, deterministically merges duplicate URLs, and retains a local backup', async () => {
    installChromeMock({
      [STORAGE_KEYS.legacyMeta]: {
        schemaVersion: 1,
        groups: [
          { id: 'work', name: '工作', createdAt: 1, updatedAt: 1 },
          { id: 'read', name: '阅读', createdAt: 2, updatedAt: 2 },
        ],
      },
      [`${STORAGE_KEYS.legacyBookmarkPrefix}old`]: { id: 'old', groupId: 'work', title: '旧标题', url: 'https://github.com/', createdAt: 3, updatedAt: 4 },
      [`${STORAGE_KEYS.legacyBookmarkPrefix}new`]: { id: 'new', groupId: 'read', title: '新标题', url: 'github.com', createdAt: 5, updatedAt: 6 },
    })
    repository = new BookmarkRepository()

    const loaded = await repository.load()
    expect(loaded.meta.tags.map((tag) => tag.id)).toEqual(['work', 'read'])
    expect(loaded.bookmarks).toEqual([expect.objectContaining({
      id: 'new', title: '新标题', tagIds: ['work', 'read'], createdAt: 3, updatedAt: 6,
    })])
    expect(getSyncStore()[STORAGE_KEYS.legacyMeta]).toBeUndefined()
    expect(getSyncStore()[STORAGE_KEYS.meta]).toBeDefined()
    expect(getLocalStore()[STORAGE_KEYS.migrationBackup]).toBeDefined()

    await chrome.storage.sync.set({
      [STORAGE_KEYS.legacyMeta]: { schemaVersion: 1, groups: [{ id: 'stale', name: '旧客户端', createdAt: 7, updatedAt: 7 }] },
      [`${STORAGE_KEYS.legacyBookmarkPrefix}stale`]: { id: 'stale', groupId: 'stale', title: '旧客户端链接', url: 'https://stale.example/', createdAt: 7, updatedAt: 7 },
    })
    expect(await repository.load()).toEqual(loaded)
  })

  it('restores v1 data when writing the migrated snapshot fails', async () => {
    const legacyMeta = {
      schemaVersion: 1,
      groups: [{ id: 'work', name: '工作', createdAt: 1, updatedAt: 1 }],
    }
    const legacyBookmark = { id: 'github', groupId: 'work', title: 'GitHub', url: 'https://github.com/', createdAt: 2, updatedAt: 2 }
    installChromeMock({
      [STORAGE_KEYS.legacyMeta]: legacyMeta,
      [`${STORAGE_KEYS.legacyBookmarkPrefix}github`]: legacyBookmark,
    })
    repository = new BookmarkRepository()
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('模拟写入失败'))

    await expect(repository.load()).rejects.toThrow('模拟写入失败')
    expect(getSyncStore()[STORAGE_KEYS.legacyMeta]).toEqual(legacyMeta)
    expect(getSyncStore()[`${STORAGE_KEYS.legacyBookmarkPrefix}github`]).toEqual(legacyBookmark)
    expect(getSyncStore()[STORAGE_KEYS.meta]).toBeUndefined()
    expect(getLocalStore()[STORAGE_KEYS.migrationBackup]).toBeDefined()
  })

  it('creates tags with a bookmark and merges a duplicate URL globally', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100)
    const first = await repository.createBookmark({
      title: 'GitHub', url: 'https://github.com', tagIds: [], newTagNames: ['工作'],
    })
    expect(first.bookmark.tagIds).toHaveLength(1)

    const second = await repository.createBookmark({
      title: '不会覆盖原标题', url: 'github.com', tagIds: [], newTagNames: ['开发'],
    })
    dateNow.mockRestore()
    expect(second).toMatchObject({ created: false, tagsMerged: true })
    const loaded = await repository.load()
    expect(loaded.meta.tags.map((tag) => tag.name)).toEqual(['工作', '开发'])
    expect(loaded.bookmarks).toHaveLength(1)
    expect(loaded.bookmarks[0]).toMatchObject({ title: 'GitHub', tagIds: expect.any(Array) })
    expect(loaded.bookmarks[0]!.tagIds).toHaveLength(2)
  })

  it('removes a tag from bookmarks without deleting them', async () => {
    const work = await repository.createTag('工作')
    const read = await repository.createTag('阅读')
    await repository.createBookmark({ title: 'MDN', url: 'https://developer.mozilla.org', tagIds: [work.id, read.id], newTagNames: [] })

    await repository.deleteTag(work.id)
    const loaded = await repository.load()
    expect(loaded.meta.tags.map((tag) => tag.id)).toEqual([read.id])
    expect(loaded.bookmarks).toHaveLength(1)
    expect(loaded.bookmarks[0]!.tagIds).toEqual([read.id])
  })

  it('does not delete a bookmark added while a tag deletion is in progress', async () => {
    const work = await repository.createTag('工作')
    await repository.createBookmark({ title: '已有链接', url: 'https://existing.example', tagIds: [work.id], newTagNames: [] })
    const originalGet = vi.mocked(chrome.storage.sync.get).getMockImplementation()!
    let getCalls = 0
    vi.mocked(chrome.storage.sync.get).mockImplementation(async (...args) => {
      getCalls += 1
      if (getCalls === 2) {
        await chrome.storage.sync.set({
          [`${STORAGE_KEYS.bookmarkPrefix}concurrent`]: {
            id: 'concurrent',
            tagIds: [],
            title: '并发新增',
            url: 'https://concurrent.example/',
            createdAt: 10,
            updatedAt: 10,
          },
        })
      }
      return originalGet(...args)
    })

    await repository.deleteTag(work.id)

    expect((await repository.load()).bookmarks.map((bookmark) => bookmark.id)).toContain('concurrent')
  })

  it('keeps bookmarks visible when two clients save different new tags concurrently', async () => {
    await repository.load()
    const otherRepository = new BookmarkRepository()

    await Promise.all([
      repository.createBookmark({ title: '本机 A', url: 'https://a.example', tagIds: [], newTagNames: ['标签 A'] }),
      otherRepository.createBookmark({ title: '本机 B', url: 'https://b.example', tagIds: [], newTagNames: ['标签 B'] }),
    ])

    const loaded = await repository.load()
    expect(loaded.meta.tags.map((tag) => tag.name)).toEqual(expect.arrayContaining(['标签 A', '标签 B']))
    expect(loaded.bookmarks.map((bookmark) => bookmark.title)).toEqual(expect.arrayContaining(['本机 A', '本机 B']))
  })

  it('merges imported tags and URLs without overwriting the local title', async () => {
    const work = await repository.createTag('工作')
    await repository.createBookmark({ title: '保留的标题', url: 'https://github.com', tagIds: [work.id], newTagNames: [] })

    const summary = await repository.importSnapshot({
      meta: { schemaVersion: 2, tags: [{ id: 'reading', name: '阅读', pinned: false, createdAt: 1, updatedAt: 1 }] },
      bookmarks: [
        { id: 'duplicate', tagIds: ['reading'], title: '导入标题', url: 'https://github.com/', createdAt: 2, updatedAt: 3 },
        { id: 'mdn', tagIds: ['reading'], title: 'MDN', url: 'https://developer.mozilla.org/', createdAt: 2, updatedAt: 3 },
      ],
    }, 'merge')

    expect(summary).toEqual({ tagsAdded: 1, bookmarksAdded: 1, bookmarksMerged: 1 })
    const loaded = await repository.load()
    expect(loaded.bookmarks.find((bookmark) => bookmark.url === 'https://github.com/')?.title).toBe('保留的标题')
    expect(loaded.bookmarks.find((bookmark) => bookmark.url === 'https://github.com/')?.tagIds).toHaveLength(2)
  })

  it('keeps an existing tag pinned when a same-name tag is imported', async () => {
    const work = await repository.createTag('工作')
    await repository.importSnapshot({
      meta: { schemaVersion: 2, tags: [{ id: 'remote-work', name: '工作', pinned: true, createdAt: 1, updatedAt: 2 }] },
      bookmarks: [],
    }, 'merge')

    expect((await repository.load()).meta.tags.find((tag) => tag.id === work.id)?.pinned).toBe(true)
  })

  it('preserves unrelated storage items when replacing snapshots', async () => {
    installChromeMock({ 'future:key': { keep: true } })
    repository = new BookmarkRepository()
    await repository.load()
    await repository.importSnapshot(snapshot(), 'replace')
    expect(getSyncStore()['future:key']).toEqual({ keep: true })
    expect((await repository.load()).meta.tags[0]?.name).toBe('工作')
  })

  it('does not let an active subscriber initialize an empty snapshot during replacement', async () => {
    await repository.importSnapshot(snapshot(), 'replace')
    const unsubscribe = repository.subscribe(() => undefined)
    const replacement: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: [{ id: 'read', name: '阅读', pinned: false, createdAt: 5, updatedAt: 5 }] },
      bookmarks: [{ id: 'mdn', tagIds: ['read'], title: 'MDN', url: 'https://developer.mozilla.org/', createdAt: 6, updatedAt: 6 }],
    }

    await repository.importSnapshot(replacement, 'replace')
    await Promise.resolve()
    await Promise.resolve()
    unsubscribe()

    expect(await repository.load()).toEqual(replacement)
  })

  it('reports when both snapshot replacement and rollback fail', async () => {
    await repository.importSnapshot(snapshot(), 'replace')
    vi.mocked(chrome.storage.sync.set)
      .mockRejectedValueOnce(new Error('新快照写入失败'))
      .mockRejectedValueOnce(new Error('旧快照恢复失败'))

    await expect(repository.importSnapshot({ meta: { schemaVersion: 2, tags: [] }, bookmarks: [] }, 'replace'))
      .rejects.toThrow('无法自动恢复原数据')
  })

  it('allows more than 30 tags while storage capacity remains available', async () => {
    for (let index = 0; index < 31; index += 1) {
      await repository.createTag(`标签 ${index}`)
    }

    expect((await repository.load()).meta.tags).toHaveLength(31)
  })

  it('surfaces a storage quota error before adding a bookmark', async () => {
    await repository.load()
    await chrome.storage.sync.set(
      Object.fromEntries(
        Array.from({ length: 15 }, (_, index) => [`future:${index}`, 'x'.repeat(7_000)]),
      ),
    )
    await expect(repository.createBookmark({ title: 'GitHub', url: 'https://github.com', tagIds: [], newTagNames: [] }))
      .rejects.toThrow('浏览器同步存储空间不足')
  })
})
