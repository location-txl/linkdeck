import { beforeEach, describe, expect, it } from 'vitest'
import { BookmarkRepository } from './bookmark-repository'
import { SYNC_QUOTA_BYTES } from '../types'
import { installChromeMock } from '../test/chrome'
import { getSyncStore } from '../test/chrome'

describe('BookmarkRepository', () => {
  let repository: BookmarkRepository

  beforeEach(() => {
    installChromeMock()
    repository = new BookmarkRepository()
  })

  it('initializes with one default group and persists independent bookmarks', async () => {
    const first = await repository.load()
    expect(first.meta.groups).toHaveLength(1)
    expect(first.meta.groups[0]?.name).toBe('默认')

    const bookmark = await repository.createBookmark({
      title: 'GitHub',
      url: 'github.com',
      groupId: first.meta.groups[0]!.id,
    })
    const loaded = await repository.load()

    expect(loaded.bookmarks).toEqual([bookmark])
  })

  it('prevents duplicate normalized URLs within the same group but permits another group', async () => {
    const initial = await repository.load()
    const firstGroup = initial.meta.groups[0]!
    const secondGroup = await repository.createGroup('工作')

    await repository.createBookmark({
      title: 'GitHub',
      url: 'github.com',
      groupId: firstGroup.id,
    })

    await expect(
      repository.createBookmark({
        title: 'GitHub again',
        url: 'https://github.com/',
        groupId: firstGroup.id,
      }),
    ).rejects.toThrow('这个分组已收藏过该网址。')

    await expect(
      repository.createBookmark({
        title: 'GitHub for work',
        url: 'https://github.com/',
        groupId: secondGroup.id,
      }),
    ).resolves.toMatchObject({ groupId: secondGroup.id })
  })

  it('does not delete a non-empty group', async () => {
    const initial = await repository.load()
    const group = initial.meta.groups[0]!
    await repository.createGroup('工作')
    await repository.createBookmark({
      title: 'GitHub',
      url: 'https://github.com',
      groupId: group.id,
    })

    await expect(repository.deleteGroup(group.id)).rejects.toThrow('分组内还有网站')
  })

  it('surfaces a storage quota error before writing', async () => {
    const initial = await repository.load()
    const sync = chrome.storage.sync as unknown as {
      getBytesInUse: (keys: null) => Promise<number>
    }
    sync.getBytesInUse = async () => SYNC_QUOTA_BYTES

    await expect(
      repository.createBookmark({
        title: 'GitHub',
        url: 'https://github.com',
        groupId: initial.meta.groups[0]!.id,
      }),
    ).rejects.toThrow('浏览器同步存储空间不足')
  })

  it('replaces all LinkDeck data while preserving unrelated storage items', async () => {
    installChromeMock({ 'future:key': { keep: true } })
    repository = new BookmarkRepository()
    const initial = await repository.load()
    await repository.createBookmark({
      title: '旧网站',
      url: 'https://old.example.com',
      groupId: initial.meta.groups[0]!.id,
    })

    await repository.importSnapshot({
      meta: {
        schemaVersion: 1,
        groups: [{ id: 'imported-group', name: '导入', createdAt: 1, updatedAt: 2 }],
      },
      bookmarks: [{
        id: 'imported-bookmark',
        groupId: 'imported-group',
        title: '新网站',
        url: 'https://new.example.com/',
        createdAt: 3,
        updatedAt: 4,
      }],
    }, 'replace')

    const loaded = await repository.load()
    expect(loaded.meta.groups).toHaveLength(1)
    expect(loaded.meta.groups[0]?.name).toBe('导入')
    expect(loaded.bookmarks.map((bookmark) => bookmark.title)).toEqual(['新网站'])
    expect(getSyncStore()['future:key']).toEqual({ keep: true })
  })

  it('merges groups by name and skips duplicate URLs without overwriting titles', async () => {
    const initial = await repository.load()
    const currentGroup = initial.meta.groups[0]!
    await repository.renameGroup(currentGroup.id, '工作')
    await repository.createBookmark({
      title: '保留的标题',
      url: 'https://github.com',
      groupId: currentGroup.id,
    })

    const summary = await repository.importSnapshot({
      meta: {
        schemaVersion: 1,
        groups: [
          { id: 'work', name: '工作', createdAt: 1, updatedAt: 2 },
          { id: 'reading', name: '阅读', createdAt: 1, updatedAt: 2 },
        ],
      },
      bookmarks: [
        { id: 'duplicate', groupId: 'work', title: '导入标题', url: 'https://github.com/', createdAt: 3, updatedAt: 4 },
        { id: 'new', groupId: 'reading', title: 'MDN', url: 'https://developer.mozilla.org/', createdAt: 3, updatedAt: 4 },
      ],
    }, 'merge')

    const loaded = await repository.load()
    expect(summary).toEqual({ groupsAdded: 1, bookmarksAdded: 1, bookmarksSkipped: 1 })
    expect(loaded.meta.groups.map((group) => group.name)).toEqual(['工作', '阅读'])
    expect(loaded.bookmarks.map((bookmark) => bookmark.title)).toEqual(
      expect.arrayContaining(['保留的标题', 'MDN']),
    )
    expect(loaded.bookmarks.find((bookmark) => bookmark.url === 'https://github.com/')?.title)
      .toBe('保留的标题')
  })

  it('restores the previous snapshot when an import write fails', async () => {
    const initial = await repository.load()
    await repository.createBookmark({
      title: '安全副本',
      url: 'https://safe.example.com',
      groupId: initial.meta.groups[0]!.id,
    })
    const sync = chrome.storage.sync as unknown as {
      set: ReturnType<typeof import('vitest').vi.fn>
    }
    sync.set.mockRejectedValueOnce(new Error('sync unavailable'))

    await expect(repository.importSnapshot({
      meta: {
        schemaVersion: 1,
        groups: [{ id: 'replacement', name: '替换', createdAt: 1, updatedAt: 2 }],
      },
      bookmarks: [],
    }, 'replace')).rejects.toThrow('原数据已恢复')

    const loaded = await repository.load()
    expect(loaded.meta.groups[0]?.name).toBe('默认')
    expect(loaded.bookmarks[0]?.title).toBe('安全副本')
  })
})
