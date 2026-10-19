import { describe, expect, it } from 'vitest'
import type { CollectionSnapshot } from '@linkdeck/bookmarks'
import { mergeInitialSnapshots, mergeThreeWaySnapshots, sameSnapshot } from './snapshot-merge'

const base: CollectionSnapshot = {
  meta: { schemaVersion: 2, tags: [{ id: 'work', name: '工作', pinned: false, createdAt: 1, updatedAt: 1 }] },
  bookmarks: [{ id: 'github', tagIds: ['work'], title: 'GitHub', url: 'https://github.com/', createdAt: 1, updatedAt: 1 }],
}

function copy(): CollectionSnapshot {
  return JSON.parse(JSON.stringify(base)) as CollectionSnapshot
}

describe('Gist 三方合并', () => {
  it('adopts a one-sided edit and deletion', () => {
    const local = copy()
    local.bookmarks[0]!.title = 'GitHub Docs'
    const remote = copy()
    remote.bookmarks = []
    expect(mergeThreeWaySnapshots(base, local, base).snapshot.bookmarks[0]?.title).toBe('GitHub Docs')
    expect(mergeThreeWaySnapshots(base, base, remote).snapshot.bookmarks).toEqual([])
  })

  it('automatically unions independent tag membership changes', () => {
    const local = copy()
    local.meta.tags.push({ id: 'read', name: '阅读', pinned: false, createdAt: 2, updatedAt: 2 })
    local.bookmarks[0]!.tagIds.push('read')
    const remote = copy()
    remote.meta.tags.push({ id: 'dev', name: '开发', pinned: false, createdAt: 3, updatedAt: 3 })
    remote.bookmarks[0]!.tagIds.push('dev')

    const result = mergeThreeWaySnapshots(base, local, remote)
    expect(result.conflicts).toEqual([])
    expect(result.snapshot.bookmarks[0]!.tagIds).toEqual(['work', 'read', 'dev'])
  })

  it('reports divergent bookmark content and resolves it to the selected side', () => {
    const local = copy()
    local.bookmarks[0]!.title = '本机标题'
    const remote = copy()
    remote.bookmarks[0]!.title = '远端标题'
    expect(mergeThreeWaySnapshots(base, local, remote).conflicts).toHaveLength(1)
    expect(mergeThreeWaySnapshots(base, local, remote, 'local').snapshot.bookmarks[0]?.title).toBe('本机标题')
    expect(mergeThreeWaySnapshots(base, local, remote, 'remote').snapshot.bookmarks[0]?.title).toBe('远端标题')
  })

  it('merges a rename on one side with a pin change on the other', () => {
    const local = copy()
    local.meta.tags[0] = { ...local.meta.tags[0]!, name: '常用工作', updatedAt: 2 }
    const remote = copy()
    remote.meta.tags[0] = { ...remote.meta.tags[0]!, pinned: true, updatedAt: 3 }

    const result = mergeThreeWaySnapshots(base, local, remote)
    expect(result.conflicts).toEqual([])
    expect(result.snapshot.meta.tags[0]).toMatchObject({ name: '常用工作', pinned: true, updatedAt: 3 })
  })

  it('resolves only the conflicting name and keeps a one-sided pin change', () => {
    const local = copy()
    local.meta.tags[0] = { ...local.meta.tags[0]!, name: '本机工作', pinned: true, updatedAt: 2 }
    const remote = copy()
    remote.meta.tags[0] = { ...remote.meta.tags[0]!, name: '远端工作', updatedAt: 3 }

    expect(mergeThreeWaySnapshots(base, local, remote, 'local').snapshot.meta.tags[0])
      .toMatchObject({ name: '本机工作', pinned: true })
    expect(mergeThreeWaySnapshots(base, local, remote, 'remote').snapshot.meta.tags[0])
      .toMatchObject({ name: '远端工作', pinned: true })
  })

  it('keeps a same-name tag pinned during the first Gist merge', () => {
    const local = copy()
    const remote = copy()
    remote.meta.tags[0] = { ...remote.meta.tags[0]!, id: 'remote-work', pinned: true, updatedAt: 2 }

    expect(mergeInitialSnapshots(local, remote).meta.tags).toEqual([
      expect.objectContaining({ id: 'work', pinned: true, updatedAt: 2 }),
    ])
  })

  it('reports a conflict instead of deleting existing bookmarks moved to the same URL', () => {
    const original: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: [] },
      bookmarks: [
        { id: 'a', tagIds: [], title: '文档', url: 'https://a.example/', createdAt: 1, updatedAt: 1 },
        { id: 'b', tagIds: [], title: '文档', url: 'https://b.example/', createdAt: 2, updatedAt: 2 },
      ],
    }
    const local = copySnapshot(original)
    local.bookmarks[0] = { ...local.bookmarks[0]!, url: 'https://common.example/', updatedAt: 3 }
    const remote = copySnapshot(original)
    remote.bookmarks[1] = { ...remote.bookmarks[1]!, url: 'https://common.example/', updatedAt: 4 }

    expect(mergeThreeWaySnapshots(original, local, remote).conflicts).toHaveLength(1)
    expect(mergeThreeWaySnapshots(original, local, remote, 'local').snapshot.bookmarks).toEqual(local.bookmarks)
    expect(mergeThreeWaySnapshots(original, local, remote, 'remote').snapshot.bookmarks).toEqual(remote.bookmarks)
  })

  it('restores the selected side when existing tags are renamed to the same name', () => {
    const original: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: [
        { id: 'work', name: '工作', pinned: false, createdAt: 1, updatedAt: 1 },
        { id: 'read', name: '阅读', pinned: false, createdAt: 2, updatedAt: 2 },
      ] },
      bookmarks: [],
    }
    const local = copySnapshot(original)
    local.meta.tags[0] = { ...local.meta.tags[0]!, name: '常用', updatedAt: 3 }
    const remote = copySnapshot(original)
    remote.meta.tags[1] = { ...remote.meta.tags[1]!, name: '常用', updatedAt: 4 }

    expect(mergeThreeWaySnapshots(original, local, remote).conflicts).toHaveLength(1)
    expect(mergeThreeWaySnapshots(original, local, remote, 'local').snapshot.meta.tags).toEqual(local.meta.tags)
    expect(mergeThreeWaySnapshots(original, local, remote, 'remote').snapshot.meta.tags).toEqual(remote.meta.tags)
  })

  it('merges more than 30 independent tags', () => {
    const empty: CollectionSnapshot = { meta: { schemaVersion: 2, tags: [] }, bookmarks: [] }
    const local: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: Array.from({ length: 20 }, (_, index) => ({
        id: `local-${index}`, name: `本机 ${index}`, pinned: false, createdAt: index, updatedAt: index,
      })) },
      bookmarks: [],
    }
    const remote: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: Array.from({ length: 20 }, (_, index) => ({
        id: `remote-${index}`, name: `远端 ${index}`, pinned: false, createdAt: 100 + index, updatedAt: 100 + index,
      })) },
      bookmarks: [],
    }

    expect(mergeThreeWaySnapshots(empty, local, remote).snapshot.meta.tags).toHaveLength(40)
  })

  it('surfaces deleted-tag references and restores the chosen side tag without orphan IDs', () => {
    const original: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: [
        { id: 'keep', name: '保留', pinned: false, createdAt: 1, updatedAt: 1 },
        { id: 'shared', name: '共享', pinned: false, createdAt: 2, updatedAt: 2 },
      ] },
      bookmarks: [],
    }
    const local: CollectionSnapshot = { meta: { schemaVersion: 2, tags: [original.meta.tags[0]!] }, bookmarks: [] }
    const remote: CollectionSnapshot = {
      meta: original.meta,
      bookmarks: [{ id: 'remote-link', tagIds: ['shared'], title: '远端新增', url: 'https://example.com/', createdAt: 3, updatedAt: 3 }],
    }

    expect(mergeThreeWaySnapshots(original, local, remote).conflicts).toHaveLength(1)
    const useRemote = mergeThreeWaySnapshots(original, local, remote, 'remote').snapshot
    expect(useRemote.meta.tags.map((tag) => tag.id)).toContain('shared')
    expect(useRemote.bookmarks[0]!.tagIds).toEqual(['shared'])
    const keepLocal = mergeThreeWaySnapshots(original, local, remote, 'local').snapshot
    expect(keepLocal.meta.tags.map((tag) => tag.id)).not.toContain('shared')
    expect(keepLocal.bookmarks[0]!.tagIds).toEqual([])
  })

  it('treats an existing link that keeps a deleted tag as a choice-side conflict', () => {
    const local = copy()
    local.meta.tags = []
    local.bookmarks[0]!.tagIds = []
    const remote = copy()
    remote.bookmarks[0]!.title = '远端继续使用工作标签'

    expect(mergeThreeWaySnapshots(base, local, remote).conflicts).toHaveLength(1)

    const useRemote = mergeThreeWaySnapshots(base, local, remote, 'remote').snapshot
    expect(useRemote.meta.tags.map((tag) => tag.id)).toEqual(['work'])
    expect(useRemote.bookmarks[0]!.tagIds).toEqual(['work'])

    const keepLocal = mergeThreeWaySnapshots(base, local, remote, 'local').snapshot
    expect(keepLocal.meta.tags).toEqual([])
    expect(keepLocal.bookmarks[0]!.tagIds).toEqual([])
  })

  it('ignores tag and membership ordering when comparing snapshots', () => {
    const reordered = copy()
    reordered.meta.tags.push({ id: 'read', name: '阅读', pinned: false, createdAt: 2, updatedAt: 2 })
    reordered.bookmarks[0]!.tagIds = ['work', 'read']
    const sameDataDifferentOrder = copy()
    sameDataDifferentOrder.meta.tags = [...reordered.meta.tags].reverse()
    sameDataDifferentOrder.bookmarks[0]!.tagIds = ['read', 'work']

    expect(sameSnapshot(reordered, sameDataDifferentOrder)).toBe(true)
  })

  it('treats v2 tags without pinned as equivalent to unpinned tags', () => {
    const legacy = copy()
    legacy.meta.tags[0] = {
      id: 'work',
      name: '工作',
      createdAt: 1,
      updatedAt: 1,
    } as CollectionSnapshot['meta']['tags'][number]

    expect(sameSnapshot(legacy, base)).toBe(true)
  })
})

function copySnapshot(snapshot: CollectionSnapshot): CollectionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as CollectionSnapshot
}
