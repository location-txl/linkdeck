import { describe, expect, it } from 'vitest'
import type { CollectionSnapshot } from '../types'
import { MAX_IMPORT_FILE_BYTES, createBackup, parseBackupJson, readBackupFile, serializeBackup } from './data-transfer'

const snapshot: CollectionSnapshot = {
  meta: { schemaVersion: 2, tags: [{ id: 'work', name: '工作', createdAt: 100, updatedAt: 200 }] },
  bookmarks: [{ id: 'bookmark-1', tagIds: ['work'], title: 'GitHub', url: 'https://github.com/', createdAt: 300, updatedAt: 400 }],
}

describe('LinkDeck JSON backup', () => {
  it('exports and parses v2 data', () => {
    const exportedAt = new Date('2026-08-09T08:00:00.000Z')
    expect(parseBackupJson(serializeBackup(snapshot, exportedAt))).toEqual(createBackup(snapshot, exportedAt))
  })

  it('accepts v1 data and normalizes it into multi-tag v2', () => {
    const legacy = {
      app: 'LinkDeck', formatVersion: 1, exportedAt: '2026-08-09T08:00:00.000Z',
      data: {
        meta: { schemaVersion: 1, groups: [{ id: 'work', name: '工作', createdAt: 1, updatedAt: 1 }] },
        bookmarks: [{ id: 'github', groupId: 'work', title: 'GitHub', url: 'https://github.com/', createdAt: 2, updatedAt: 2 }],
      },
    }
    expect(parseBackupJson(JSON.stringify(legacy))).toMatchObject({
      formatVersion: 2,
      data: { meta: { tags: [{ id: 'work', name: '工作' }] }, bookmarks: [{ tagIds: ['work'] }] },
    })
  })

  it('rejects invalid JSON, unsupported formats, invalid tag references, and duplicate URLs', () => {
    expect(() => parseBackupJson('{')).toThrow('无法解析 JSON')
    expect(() => parseBackupJson(JSON.stringify({ ...createBackup(snapshot), formatVersion: 3 }))).toThrow('受支持')

    const missingTag = createBackup(snapshot)
    missingTag.data.bookmarks[0]!.tagIds = ['missing']
    expect(() => parseBackupJson(JSON.stringify(missingTag))).toThrow('不存在的标签')

    const duplicateUrl = createBackup(snapshot)
    duplicateUrl.data.bookmarks.push({ ...snapshot.bookmarks[0]!, id: 'bookmark-2', tagIds: [] })
    expect(() => parseBackupJson(JSON.stringify(duplicateUrl))).toThrow('存在重复网址')
  })

  it('rejects oversized files before reading', async () => {
    const file = new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], 'oversized.json', { type: 'application/json' })
    await expect(readBackupFile(file)).rejects.toThrow('不能超过 1 MB')
  })

  it('accepts more than 30 tags when the storage quota permits it', () => {
    const manyTags: CollectionSnapshot = {
      meta: { schemaVersion: 2, tags: Array.from({ length: 31 }, (_, index) => ({
        id: `tag-${index}`, name: `标签 ${index}`, createdAt: index, updatedAt: index,
      })) },
      bookmarks: [],
    }

    expect(parseBackupJson(serializeBackup(manyTags)).data.meta.tags).toHaveLength(31)
  })
})
