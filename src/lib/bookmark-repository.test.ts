import { beforeEach, describe, expect, it } from 'vitest'
import { BookmarkRepository } from './bookmark-repository'
import { SYNC_QUOTA_BYTES } from '../types'
import { installChromeMock } from '../test/chrome'

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
})

