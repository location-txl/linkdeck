import {
  MAX_SYNC_ITEMS,
  STORAGE_KEYS,
  SYNC_QUOTA_BYTES,
  SYNC_QUOTA_BYTES_PER_ITEM,
  type Bookmark,
  type CollectionSnapshot,
  type LegacyBookmark,
  type LegacyCollectionSnapshot,
  type LegacyGroup,
  type Tag,
} from '@linkdeck/bookmarks'
import { UserFacingError, normalizeUrl, storageItemBytes } from '@linkdeck/shared'
import { validateBookmarkTitle, validateTagName } from '@linkdeck/bookmarks/validation'
import { migrateLegacySnapshot } from '@linkdeck/bookmarks/migration'

export const MAX_IMPORT_FILE_BYTES = 1024 * 1024

/** 所有成功解析的备份都会被规范化为当前 v2 数据格式。 */
export type LinkDeckBackup = {
  app: 'LinkDeck'
  formatVersion: 2
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

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new UserFacingError(message)
}

function parseTag(value: unknown, index: number): Tag {
  const candidate = requiredRecord(value, `第 ${index + 1} 个标签`)
  if (candidate.pinned !== undefined && typeof candidate.pinned !== 'boolean') {
    throw new UserFacingError(`第 ${index + 1} 个标签的置顶状态格式不正确。`)
  }
  return {
    id: requiredString(candidate.id, `第 ${index + 1} 个标签的 ID`).trim(),
    name: validateTagName(requiredString(candidate.name, `第 ${index + 1} 个标签的名称`)),
    pinned: candidate.pinned === true,
    createdAt: requiredTimestamp(candidate.createdAt, `第 ${index + 1} 个标签的创建时间`),
    updatedAt: requiredTimestamp(candidate.updatedAt, `第 ${index + 1} 个标签的更新时间`),
  }
}

function parseBookmark(value: unknown, index: number, tagIds: Set<string>): Bookmark {
  const candidate = requiredRecord(value, `第 ${index + 1} 个收藏`)
  const tags = requiredArray(candidate.tagIds, `第 ${index + 1} 个收藏的标签列表`)
    .map((tagId, tagIndex) => requiredString(tagId, `第 ${index + 1} 个收藏的第 ${tagIndex + 1} 个标签 ID`).trim())
  assertUnique(tags, `第 ${index + 1} 个收藏包含重复标签。`)
  if (tags.some((tagId) => !tagIds.has(tagId))) {
    throw new UserFacingError(`第 ${index + 1} 个收藏引用了不存在的标签。`)
  }

  const url = normalizeUrl(requiredString(candidate.url, `第 ${index + 1} 个收藏的网址`))
  return {
    id: requiredString(candidate.id, `第 ${index + 1} 个收藏的 ID`).trim(),
    tagIds: tags,
    title: validateBookmarkTitle(requiredString(candidate.title, `第 ${index + 1} 个收藏的名称`), url),
    url,
    createdAt: requiredTimestamp(candidate.createdAt, `第 ${index + 1} 个收藏的创建时间`),
    updatedAt: requiredTimestamp(candidate.updatedAt, `第 ${index + 1} 个收藏的更新时间`),
  }
}

function parseLegacyGroup(value: unknown, index: number): LegacyGroup {
  const candidate = requiredRecord(value, `第 ${index + 1} 个分组`)
  return {
    id: requiredString(candidate.id, `第 ${index + 1} 个分组的 ID`).trim(),
    name: validateTagName(requiredString(candidate.name, `第 ${index + 1} 个分组的名称`)),
    createdAt: requiredTimestamp(candidate.createdAt, `第 ${index + 1} 个分组的创建时间`),
    updatedAt: requiredTimestamp(candidate.updatedAt, `第 ${index + 1} 个分组的更新时间`),
  }
}

function parseLegacyBookmark(value: unknown, index: number, groupIds: Set<string>): LegacyBookmark {
  const candidate = requiredRecord(value, `第 ${index + 1} 个收藏`)
  const groupId = requiredString(candidate.groupId, `第 ${index + 1} 个收藏的分组 ID`).trim()
  if (!groupIds.has(groupId)) throw new UserFacingError(`第 ${index + 1} 个收藏引用了不存在的分组。`)
  const url = normalizeUrl(requiredString(candidate.url, `第 ${index + 1} 个收藏的网址`))
  return {
    id: requiredString(candidate.id, `第 ${index + 1} 个收藏的 ID`).trim(),
    groupId,
    title: validateBookmarkTitle(requiredString(candidate.title, `第 ${index + 1} 个收藏的名称`), url),
    url,
    createdAt: requiredTimestamp(candidate.createdAt, `第 ${index + 1} 个收藏的创建时间`),
    updatedAt: requiredTimestamp(candidate.updatedAt, `第 ${index + 1} 个收藏的更新时间`),
  }
}

/** 校验当前 v2 快照在 Chrome 同步存储中的项目与字节配额。 */
export function validateSnapshotCapacity(snapshot: CollectionSnapshot): void {
  const items: Array<[string, unknown]> = [
    [STORAGE_KEYS.meta, { schemaVersion: 2, tags: [] }],
    ...snapshot.meta.tags.map((tag) => [
      `${STORAGE_KEYS.tagPrefix}${tag.id}`,
      tag,
    ] as [string, unknown]),
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

function parseV2Snapshot(data: UnknownRecord): CollectionSnapshot {
  const meta = requiredRecord(data.meta, '标签数据')
  if (meta.schemaVersion !== 2) throw new UserFacingError('备份中的数据版本不受支持。')
  const rawTags = requiredArray(meta.tags, '标签列表')
  const tags = rawTags.map(parseTag)
  assertUnique(tags.map((tag) => tag.id), '备份中存在重复的标签 ID。')
  assertUnique(tags.map((tag) => tag.name.toLocaleLowerCase()), '备份中存在同名标签。')

  const bookmarks = requiredArray(data.bookmarks, '收藏列表').map((value, index) =>
    parseBookmark(value, index, new Set(tags.map((tag) => tag.id))),
  )
  assertUnique(bookmarks.map((bookmark) => bookmark.id), '备份中存在重复的收藏 ID。')
  assertUnique(bookmarks.map((bookmark) => bookmark.url), '备份中存在重复网址。')
  return { meta: { schemaVersion: 2, tags }, bookmarks }
}

function parseV1Snapshot(data: UnknownRecord): LegacyCollectionSnapshot {
  const meta = requiredRecord(data.meta, '分组数据')
  if (meta.schemaVersion !== 1) throw new UserFacingError('备份中的数据版本不受支持。')
  const rawGroups = requiredArray(meta.groups, '分组列表')
  if (rawGroups.length === 0) throw new UserFacingError('备份中至少需要一个分组。')
  const groups = rawGroups.map(parseLegacyGroup)
  assertUnique(groups.map((group) => group.id), '备份中存在重复的分组 ID。')
  assertUnique(groups.map((group) => group.name.toLocaleLowerCase()), '备份中存在同名分组。')
  const bookmarks = requiredArray(data.bookmarks, '收藏列表').map((value, index) =>
    parseLegacyBookmark(value, index, new Set(groups.map((group) => group.id))),
  )
  assertUnique(bookmarks.map((bookmark) => bookmark.id), '备份中存在重复的收藏 ID。')
  return { meta: { schemaVersion: 1, groups }, bookmarks }
}

/** 解析 v1/v2 备份，并统一输出经容量校验的 v2 数据。 */
export function parseBackupJson(text: string): LinkDeckBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new UserFacingError('无法解析 JSON 文件，请确认文件内容完整。')
  }

  const backup = requiredRecord(raw, '备份文件')
  if (backup.app !== 'LinkDeck' || (backup.formatVersion !== 1 && backup.formatVersion !== 2)) {
    throw new UserFacingError('这不是受支持的 LinkDeck 备份文件。')
  }
  const exportedAt = requiredString(backup.exportedAt, '导出时间')
  if (Number.isNaN(Date.parse(exportedAt))) throw new UserFacingError('备份文件的导出时间格式不正确。')

  const data = requiredRecord(backup.data, '备份数据')
  const snapshot = backup.formatVersion === 1
    ? migrateLegacySnapshot(parseV1Snapshot(data))
    : parseV2Snapshot(data)
  validateSnapshotCapacity(snapshot)

  return {
    app: 'LinkDeck',
    formatVersion: 2,
    exportedAt: new Date(exportedAt).toISOString(),
    data: snapshot,
  }
}

export function createBackup(snapshot: CollectionSnapshot, now = new Date()): LinkDeckBackup {
  return {
    app: 'LinkDeck',
    formatVersion: 2,
    exportedAt: now.toISOString(),
    data: JSON.parse(JSON.stringify(snapshot)) as CollectionSnapshot,
  }
}

export function serializeBackup(snapshot: CollectionSnapshot, now = new Date()): string {
  return `${JSON.stringify(createBackup(snapshot, now), null, 2)}\n`
}

export async function readBackupFile(file: File): Promise<LinkDeckBackup> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new UserFacingError('JSON 文件不能超过 1 MB。')
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new UserFacingError('无法读取 JSON 文件，请重新选择。'))
    })
    reader.addEventListener('error', () => reject(new UserFacingError('无法读取 JSON 文件，请重新选择。')))
    reader.readAsText(file)
  })
  return parseBackupJson(text)
}

export function downloadBackup(snapshot: CollectionSnapshot, now = new Date()): string {
  const filename = `linkdeck-backup-${now.toISOString().slice(0, 10)}.json`
  const blob = new Blob([serializeBackup(snapshot, now)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return filename
}
