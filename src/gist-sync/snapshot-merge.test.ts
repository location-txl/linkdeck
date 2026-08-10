import { describe, expect, it } from 'vitest'
import type { CollectionSnapshot } from '../types'
import { mergeThreeWaySnapshots } from './snapshot-merge'

const base: CollectionSnapshot = {
  meta: {
    schemaVersion: 1,
    groups: [{ id: 'work', name: '工作', createdAt: 1, updatedAt: 1 }],
  },
  bookmarks: [{
    id: 'github',
    groupId: 'work',
    title: 'GitHub',
    url: 'https://github.com/',
    createdAt: 1,
    updatedAt: 1,
  }],
}

function copy(): CollectionSnapshot {
  return JSON.parse(JSON.stringify(base)) as CollectionSnapshot
}

describe('Gist 三方合并', () => {
  it('adopts a one-sided edit and a one-sided deletion', () => {
    const local = copy()
    local.bookmarks[0]!.title = 'GitHub Docs'
    const remote = copy()
    remote.bookmarks = []

    const localOnly = mergeThreeWaySnapshots(base, local, base)
    expect(localOnly.conflicts).toEqual([])
    expect(localOnly.snapshot.bookmarks[0]?.title).toBe('GitHub Docs')

    const remoteOnly = mergeThreeWaySnapshots(base, base, remote)
    expect(remoteOnly.conflicts).toEqual([])
    expect(remoteOnly.snapshot.bookmarks).toEqual([])
  })

  it('merges independent additions from both devices', () => {
    const local = copy()
    local.bookmarks.push({
      id: 'mdn', groupId: 'work', title: 'MDN', url: 'https://developer.mozilla.org/', createdAt: 2, updatedAt: 2,
    })
    const remote = copy()
    remote.bookmarks.push({
      id: 'vite', groupId: 'work', title: 'Vite', url: 'https://vite.dev/', createdAt: 3, updatedAt: 3,
    })

    const result = mergeThreeWaySnapshots(base, local, remote)
    expect(result.conflicts).toEqual([])
    expect(result.snapshot.bookmarks.map((bookmark) => bookmark.id)).toEqual(
      expect.arrayContaining(['github', 'mdn', 'vite']),
    )
  })

  it('reports competing edits and resolves them as one selected side', () => {
    const local = copy()
    local.bookmarks[0]!.title = '本机标题'
    const remote = copy()
    remote.bookmarks[0]!.title = '远端标题'

    expect(mergeThreeWaySnapshots(base, local, remote).conflicts).toHaveLength(1)
    expect(mergeThreeWaySnapshots(base, local, remote, 'local').snapshot.bookmarks[0]?.title).toBe('本机标题')
    expect(mergeThreeWaySnapshots(base, local, remote, 'remote').snapshot.bookmarks[0]?.title).toBe('远端标题')
  })

  it('treats concurrent same-name groups and divergent same URLs as conflicts', () => {
    const empty: CollectionSnapshot = { meta: { schemaVersion: 1, groups: [] }, bookmarks: [] }
    const local: CollectionSnapshot = {
      meta: { schemaVersion: 1, groups: [{ id: 'local-group', name: '阅读', createdAt: 1, updatedAt: 1 }] },
      bookmarks: [{ id: 'local-link', groupId: 'local-group', title: 'MDN 中文', url: 'https://developer.mozilla.org/', createdAt: 1, updatedAt: 1 }],
    }
    const remote: CollectionSnapshot = {
      meta: { schemaVersion: 1, groups: [{ id: 'remote-group', name: '阅读', createdAt: 2, updatedAt: 2 }] },
      bookmarks: [{ id: 'remote-link', groupId: 'remote-group', title: 'MDN', url: 'https://developer.mozilla.org/', createdAt: 2, updatedAt: 2 }],
    }

    const result = mergeThreeWaySnapshots(empty, local, remote)
    expect(result.conflicts).toHaveLength(2)
  })

  it('restores the selected parent group for an orphaned bookmark conflict', () => {
    const keep = { id: 'keep', name: '保留', createdAt: 1, updatedAt: 1 }
    const shared = { id: 'shared', name: '共享', createdAt: 2, updatedAt: 2 }
    const original: CollectionSnapshot = {
      meta: { schemaVersion: 1, groups: [keep, shared] },
      bookmarks: [],
    }
    const local: CollectionSnapshot = {
      meta: { schemaVersion: 1, groups: [keep] },
      bookmarks: [],
    }
    const remote: CollectionSnapshot = {
      meta: { schemaVersion: 1, groups: [keep, shared] },
      bookmarks: [{
        id: 'remote-link',
        groupId: 'shared',
        title: '远端新增',
        url: 'https://example.com/',
        createdAt: 3,
        updatedAt: 3,
      }],
    }

    expect(mergeThreeWaySnapshots(original, local, remote).conflicts).toHaveLength(1)

    const useRemote = mergeThreeWaySnapshots(original, local, remote, 'remote').snapshot
    expect(useRemote.meta.groups.map((group) => group.id)).toContain('shared')
    expect(useRemote.bookmarks.map((bookmark) => bookmark.id)).toContain('remote-link')

    const keepLocal = mergeThreeWaySnapshots(original, local, remote, 'local').snapshot
    expect(keepLocal.meta.groups.map((group) => group.id)).not.toContain('shared')
    expect(keepLocal.bookmarks).toEqual([])
  })
})
