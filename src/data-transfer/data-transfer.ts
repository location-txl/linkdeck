import {
  MAX_GROUPS,
  MAX_SYNC_ITEMS,
  STORAGE_KEYS,
  SYNC_QUOTA_BYTES,
  SYNC_QUOTA_BYTES_PER_ITEM,
  type Bookmark,
  type CollectionSnapshot,
  type Group,
} from '../types'
import {
  UserFacingError,
  normalizeUrl,
  storageItemBytes,
  validateBookmarkTitle,
  validateGroupName,
} from '../lib/bookmark-utils'

export const MAX_IMPORT_FILE_BYTES = 1024 * 1024

export type LinkDeckBackup = {
  app: 'LinkDeck'
  formatVersion: 1
  exportedAt: string
  data: CollectionSnapshot
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new UserFacingError(`${label}格式不正确。`)
  return value
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new UserFacingError(`${label}格式不正确。`)
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UserFacingError(`${label}格式不正确。`)
  }
  return value
}

function requiredTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new UserFacingError(`${label}格式不正确。`)
  }
  return value
}

function parseGroup(value: unknown, index: number): Group {
  const candidate = requiredRecord(value, `第 ${index + 1} 个分组`)
  return {
    id: requiredString(candidate.id, `第 ${index + 1} 个分组的 ID`).trim(),
    name: validateGroupName(requiredString(candidate.name, `第 ${index + 1} 个分组的名称`)),
    createdAt: requiredTimestamp(candidate.createdAt, `第 ${index + 1} 个分组的创建时间`),
    updatedAt: requiredTimestamp(candidate.updatedAt, `第 ${index + 1} 个分组的更新时间`),
  }
}

function parseBookmark(value: unknown, index: number, groupIds: Set<string>): Bookmark {
  const candidate = requiredRecord(value, `第 ${index + 1} 个收藏`)
  const id = requiredString(candidate.id, `第 ${index + 1} 个收藏的 ID`).trim()
  const groupId = requiredString(candidate.groupId, `第 ${index + 1} 个收藏的分组 ID`).trim()
  if (!groupIds.has(groupId)) {
    throw new UserFacingError(`第 ${index + 1} 个收藏引用了不存在的分组。`)
  }

  const url = normalizeUrl(requiredString(candidate.url, `第 ${index + 1} 个收藏的网址`))
  const title = validateBookmarkTitle(
    requiredString(candidate.title, `第 ${index + 1} 个收藏的名称`),
    url,
  )

  return {
    id,
    groupId,
    title,
    url,
    createdAt: requiredTimestamp(candidate.createdAt, `第 ${index + 1} 个收藏的创建时间`),
    updatedAt: requiredTimestamp(candidate.updatedAt, `第 ${index + 1} 个收藏的更新时间`),
  }
}

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new UserFacingError(message)
}

function validateSnapshotCapacity(snapshot: CollectionSnapshot): void {
  const items: Array<[string, unknown]> = [
    [STORAGE_KEYS.meta, snapshot.meta],
    ...snapshot.bookmarks.map((bookmark) => [
      `${STORAGE_KEYS.bookmarkPrefix}${bookmark.id}`,
      bookmark,
    ] as [string, unknown]),
  ]

  if (items.length > MAX_SYNC_ITEMS) {
    throw new UserFacingError('备份中的收藏数量超过同步存储上限。')
  }

  let totalBytes = 0
  for (const [key, value] of items) {
    const bytes = storageItemBytes(key, value)
    if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) {
      throw new UserFacingError('备份中存在超过单项同步存储上限的数据。')
    }
    totalBytes += bytes
  }

  if (totalBytes > SYNC_QUOTA_BYTES) {
    throw new UserFacingError('备份数据超过浏览器同步存储空间上限。')
  }
}

export function parseBackupJson(text: string): LinkDeckBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new UserFacingError('无法解析 JSON 文件，请确认文件内容完整。')
  }

  const backup = requiredRecord(raw, '备份文件')
  if (backup.app !== 'LinkDeck' || backup.formatVersion !== 1) {
    throw new UserFacingError('这不是受支持的 LinkDeck 备份文件。')
  }
  const exportedAt = requiredString(backup.exportedAt, '导出时间')
  if (Number.isNaN(Date.parse(exportedAt))) {
    throw new UserFacingError('备份文件的导出时间格式不正确。')
  }

  const data = requiredRecord(backup.data, '备份数据')
  const meta = requiredRecord(data.meta, '分组数据')
  if (meta.schemaVersion !== 1) {
    throw new UserFacingError('备份中的数据版本不受支持。')
  }

  const rawGroups = requiredArray(meta.groups, '分组列表')
  if (rawGroups.length === 0) throw new UserFacingError('备份中至少需要一个分组。')
  if (rawGroups.length > MAX_GROUPS) {
    throw new UserFacingError(`备份中的分组不能超过 ${MAX_GROUPS} 个。`)
  }

  const groups = rawGroups.map(parseGroup)
  assertUnique(groups.map((group) => group.id), '备份中存在重复的分组 ID。')
  assertUnique(
    groups.map((group) => group.name.toLocaleLowerCase()),
    '备份中存在同名分组。',
  )

  const groupIds = new Set(groups.map((group) => group.id))
  const bookmarks = requiredArray(data.bookmarks, '收藏列表').map((value, index) =>
    parseBookmark(value, index, groupIds),
  )
  assertUnique(bookmarks.map((bookmark) => bookmark.id), '备份中存在重复的收藏 ID。')
  assertUnique(
    bookmarks.map((bookmark) => `${bookmark.groupId}\n${bookmark.url}`),
    '备份的同一分组中存在重复网址。',
  )

  const snapshot: CollectionSnapshot = {
    meta: { schemaVersion: 1, groups },
    bookmarks,
  }
  validateSnapshotCapacity(snapshot)

  return {
    app: 'LinkDeck',
    formatVersion: 1,
    exportedAt: new Date(exportedAt).toISOString(),
    data: snapshot,
  }
}

export function createBackup(snapshot: CollectionSnapshot, now = new Date()): LinkDeckBackup {
  return {
    app: 'LinkDeck',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    data: JSON.parse(JSON.stringify(snapshot)) as CollectionSnapshot,
  }
}

export function serializeBackup(snapshot: CollectionSnapshot, now = new Date()): string {
  return `${JSON.stringify(createBackup(snapshot, now), null, 2)}\n`
}

export async function readBackupFile(file: File): Promise<LinkDeckBackup> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new UserFacingError('JSON 文件不能超过 1 MB。')
  }
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new UserFacingError('无法读取 JSON 文件，请重新选择。'))
      }
    })
    reader.addEventListener('error', () => {
      reject(new UserFacingError('无法读取 JSON 文件，请重新选择。'))
    })
    reader.readAsText(file)
  })
  return parseBackupJson(text)
}

export function downloadBackup(snapshot: CollectionSnapshot, now = new Date()): string {
  const date = now.toISOString().slice(0, 10)
  const filename = `linkdeck-backup-${date}.json`
  const blob = new Blob([serializeBackup(snapshot, now)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return filename
}
