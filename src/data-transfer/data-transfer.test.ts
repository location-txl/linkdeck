import { describe, expect, it } from 'vitest'
import type { CollectionSnapshot } from '../types'
import {
  MAX_IMPORT_FILE_BYTES,
  createBackup,
  parseBackupJson,
  readBackupFile,
  serializeBackup,
} from './data-transfer'

const snapshot: CollectionSnapshot = {
  meta: {
    schemaVersion: 1,
    groups: [
      { id: 'group-1', name: '工作', createdAt: 100, updatedAt: 200 },
    ],
  },
  bookmarks: [
    {
      id: 'bookmark-1',
      groupId: 'group-1',
      title: 'GitHub',
      url: 'https://github.com/',
      createdAt: 300,
      updatedAt: 400,
    },
  ],
}

describe('LinkDeck JSON backup', () => {
  it('round-trips every stored field', () => {
    const exportedAt = new Date('2026-08-09T08:00:00.000Z')
    const parsed = parseBackupJson(serializeBackup(snapshot, exportedAt))

    expect(parsed).toEqual(createBackup(snapshot, exportedAt))
  })

  it('rejects invalid JSON and unsupported formats', () => {
    expect(() => parseBackupJson('{')).toThrow('无法解析 JSON')
    expect(() =>
      parseBackupJson(JSON.stringify({ ...createBackup(snapshot), formatVersion: 2 })),
    ).toThrow('受支持')
  })

  it('rejects empty groups and duplicate group IDs', () => {
    const emptyGroups = createBackup(snapshot)
    emptyGroups.data.meta.groups = []
    expect(() => parseBackupJson(JSON.stringify(emptyGroups))).toThrow('至少需要一个分组')

    const duplicateGroups = createBackup(snapshot)
    duplicateGroups.data.meta.groups.push({ ...snapshot.meta.groups[0]! })
    expect(() => parseBackupJson(JSON.stringify(duplicateGroups))).toThrow('重复的分组 ID')
  })

  it('rejects missing group references, invalid URLs, and duplicate URLs', () => {
    const missingGroup = createBackup(snapshot)
    missingGroup.data.bookmarks[0]!.groupId = 'missing'
    expect(() => parseBackupJson(JSON.stringify(missingGroup))).toThrow('不存在的分组')

    const invalidUrl = createBackup(snapshot)
    invalidUrl.data.bookmarks[0]!.url = 'javascript:alert(1)'
    expect(() => parseBackupJson(JSON.stringify(invalidUrl))).toThrow('只支持 http 或 https')

    const duplicateUrl = createBackup(snapshot)
    duplicateUrl.data.bookmarks.push({
      ...snapshot.bookmarks[0]!,
      id: 'bookmark-2',
      url: 'github.com',
    })
    expect(() => parseBackupJson(JSON.stringify(duplicateUrl))).toThrow('存在重复网址')
  })

  it('rejects files larger than 1 MB before reading them', async () => {
    const file = new File(
      [new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)],
      'oversized.json',
      { type: 'application/json' },
    )

    await expect(readBackupFile(file)).rejects.toThrow('不能超过 1 MB')
  })
})
