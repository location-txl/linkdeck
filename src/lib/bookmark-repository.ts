import {
  MAX_SYNC_ITEMS,
  STORAGE_KEYS,
  SYNC_QUOTA_BYTES,
  SYNC_QUOTA_BYTES_PER_ITEM,
  type Bookmark,
  type BookmarkDraft,
  type BookmarkSaveResult,
  type CollectionSnapshot,
  type ImportMode,
  type ImportSummary,
  type LegacyBookmark,
  type LegacyCollectionSnapshot,
  type LegacyGroup,
  type LinkDeckMeta,
  type Tag,
} from '../types'
import {
  UserFacingError,
  hasSameUrl,
  normalizeUrl,
  storageItemBytes,
  validateBookmarkTitle,
  validateTagName,
} from './bookmark-utils'
import { migrateLegacySnapshot } from './snapshot-migration'

type StorageRecord = Record<string, unknown>
type FallbackListener = () => void

const fallbackStorage = new Map<string, unknown>()
const fallbackLocalStorage = new Map<string, unknown>()
const fallbackListeners = new Set<FallbackListener>()
const STORAGE_MUTATION_LOCK = 'linkdeck:sync-storage-mutation'
let fallbackStorageMutationQueue: Promise<void> = Promise.resolve()

/**
 * 串行化所有同步存储的读改写，协调 popup 与 MV3 service worker 的并发操作。
 *
 * Web Locks 可跨扩展上下文共享；测试环境或不支持 Web Locks 的运行时退回当前
 * JavaScript 上下文内的 FIFO 队列，保证本地 fallback 存储仍具有确定的顺序。
 */
function enqueueStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(STORAGE_MUTATION_LOCK, () => mutation()).then((result) => result)
  }
  const next = fallbackStorageMutationQueue.then(mutation, mutation)
  fallbackStorageMutationQueue = next.then(() => undefined, () => undefined)
  return next
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasChromeSyncStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync)
}

function hasChromeLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

async function getAllSyncItems(): Promise<StorageRecord> {
  if (hasChromeSyncStorage()) return (await chrome.storage.sync.get(null)) as StorageRecord
  return Object.fromEntries([...fallbackStorage.entries()].map(([key, value]) => [key, clone(value)]))
}

async function setSyncItems(items: StorageRecord): Promise<void> {
  if (hasChromeSyncStorage()) {
    await chrome.storage.sync.set(items)
    return
  }
  Object.entries(items).forEach(([key, value]) => fallbackStorage.set(key, clone(value)))
  fallbackListeners.forEach((listener) => listener())
}

async function removeSyncItems(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  if (hasChromeSyncStorage()) {
    await chrome.storage.sync.remove(keys)
    return
  }
  keys.forEach((key) => fallbackStorage.delete(key))
  fallbackListeners.forEach((listener) => listener())
}

async function saveMigrationBackup(snapshot: LegacyCollectionSnapshot): Promise<void> {
  if (hasChromeLocalStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.migrationBackup]: snapshot })
    return
  }
  fallbackLocalStorage.set(STORAGE_KEYS.migrationBackup, clone(snapshot))
}

function createId(): string {
  return crypto.randomUUID()
}

function createEmptyMeta(): LinkDeckMeta {
  return { schemaVersion: 2, tags: [] }
}

function normalizeTag(value: unknown): Tag | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<Tag>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' ||
    typeof candidate.createdAt !== 'number' || typeof candidate.updatedAt !== 'number' ||
    (candidate.pinned !== undefined && typeof candidate.pinned !== 'boolean')) return undefined
  return {
    id: candidate.id,
    name: candidate.name,
    pinned: candidate.pinned === true,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

function isBookmark(value: unknown): value is Bookmark {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Bookmark>
  return typeof candidate.id === 'string' && Array.isArray(candidate.tagIds) &&
    candidate.tagIds.every((tagId) => typeof tagId === 'string') &&
    typeof candidate.title === 'string' && typeof candidate.url === 'string' &&
    typeof candidate.createdAt === 'number' && typeof candidate.updatedAt === 'number'
}

function isLegacyGroup(value: unknown): value is LegacyGroup {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LegacyGroup>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' &&
    typeof candidate.createdAt === 'number' && typeof candidate.updatedAt === 'number'
}

function isLegacyBookmark(value: unknown): value is LegacyBookmark {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LegacyBookmark>
  return typeof candidate.id === 'string' && typeof candidate.groupId === 'string' &&
    typeof candidate.title === 'string' && typeof candidate.url === 'string' &&
    typeof candidate.createdAt === 'number' && typeof candidate.updatedAt === 'number'
}

function parseMeta(value: unknown): LinkDeckMeta | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<LinkDeckMeta>
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.tags)) {
    return undefined
  }
  const tags: Tag[] = []
  for (const value of candidate.tags) {
    const tag = normalizeTag(value)
    if (!tag) return undefined
    tags.push(tag)
  }
  return { schemaVersion: 2, tags }
}

function parseLegacySnapshot(allItems: StorageRecord): LegacyCollectionSnapshot | undefined {
  const value = allItems[STORAGE_KEYS.legacyMeta]
  if (!value || typeof value !== 'object') return undefined
  const meta = value as { schemaVersion?: unknown; groups?: unknown }
  if (meta.schemaVersion !== 1 || !Array.isArray(meta.groups) || meta.groups.length === 0 || !meta.groups.every(isLegacyGroup)) {
    return undefined
  }
  const groups = meta.groups as LegacyGroup[]
  const groupIds = new Set(groups.map((group) => group.id))
  const bookmarks = Object.entries(allItems)
    .filter(([key, value]) => key.startsWith(STORAGE_KEYS.legacyBookmarkPrefix) && isLegacyBookmark(value))
    .map(([, value]) => value as LegacyBookmark)
    .filter((bookmark) => groupIds.has(bookmark.groupId))
    .sort((left, right) => left.createdAt - right.createdAt)
  return { meta: { schemaVersion: 1, groups: clone(groups) }, bookmarks: clone(bookmarks) }
}

function bookmarkKey(id: string): string {
  return `${STORAGE_KEYS.bookmarkPrefix}${id}`
}

function tagKey(id: string): string {
  return `${STORAGE_KEYS.tagPrefix}${id}`
}

/** 为新标签生成严格晚于现有标签的时间戳，保证独立存储后的展示顺序稳定。 */
function nextTagTimestamp(tags: Tag[]): number {
  return tags.reduce((next, tag) => Math.max(next, tag.createdAt + 1), Date.now())
}

function isV2LinkDeckKey(key: string): boolean {
  return key === STORAGE_KEYS.meta || key.startsWith(STORAGE_KEYS.tagPrefix) ||
    key.startsWith(STORAGE_KEYS.bookmarkPrefix)
}

function isLegacyLinkDeckKey(key: string): boolean {
  return key === STORAGE_KEYS.legacyMeta || key.startsWith(STORAGE_KEYS.legacyBookmarkPrefix)
}

function snapshotItems(snapshot: CollectionSnapshot): StorageRecord {
  return {
    // 标签拆成独立存储项，避免两个客户端新增不同标签时互相覆盖整份 meta。
    [STORAGE_KEYS.meta]: createEmptyMeta(),
    ...Object.fromEntries(snapshot.meta.tags.map((tag) => [tagKey(tag.id), tag])),
    ...Object.fromEntries(snapshot.bookmarks.map((bookmark) => [bookmarkKey(bookmark.id), bookmark])),
  }
}

function snapshotFromItems(allItems: StorageRecord): CollectionSnapshot | undefined {
  const meta = parseMeta(allItems[STORAGE_KEYS.meta])
  if (!meta) return undefined

  const tagsById = new Map(meta.tags.map((tag) => [tag.id, tag]))
  Object.entries(allItems)
    .filter(([key]) => key.startsWith(STORAGE_KEYS.tagPrefix))
    .forEach(([, value]) => {
      const tag = normalizeTag(value)
      if (tag) tagsById.set(tag.id, tag)
    })
  const tags = [...tagsById.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  const tagIds = new Set(tags.map((tag) => tag.id))
  const bookmarks = Object.entries(allItems)
    .filter(([key, value]) => key.startsWith(STORAGE_KEYS.bookmarkPrefix) && isBookmark(value))
    .map(([, value]) => value as Bookmark)
    // 缺失标签不能让整条收藏消失；删除标签或并发写入时只剔除失效关联。
    .map((bookmark) => ({
      ...bookmark,
      tagIds: orderedTagIds(bookmark.tagIds.filter((tagId) => tagIds.has(tagId)), tags),
    }))
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  return { meta: { schemaVersion: 2, tags }, bookmarks }
}

function sameSnapshot(left: CollectionSnapshot, right: CollectionSnapshot): boolean {
  const normalize = (snapshot: CollectionSnapshot) => ({
    schemaVersion: snapshot.meta.schemaVersion,
    tags: [...snapshot.meta.tags]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        pinned: tag.pinned === true,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      })),
    bookmarks: [...snapshot.bookmarks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((bookmark) => ({
        id: bookmark.id,
        tagIds: [...bookmark.tagIds].sort(),
        title: bookmark.title,
        url: bookmark.url,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
      })),
  })
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function assertStorageCapacity(items: StorageRecord): void {
  if (Object.keys(items).length > MAX_SYNC_ITEMS) {
    throw new UserFacingError('同步存储已达到项目数量上限。')
  }
  let totalBytes = 0
  for (const [key, value] of Object.entries(items)) {
    const bytes = storageItemBytes(key, value)
    if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) {
      throw new UserFacingError('单条数据太大，无法同步保存。')
    }
    totalBytes += bytes
  }
  if (totalBytes > SYNC_QUOTA_BYTES) {
    throw new UserFacingError('浏览器同步存储空间不足，无法保存。')
  }
}

function orderedTagIds(tagIds: Iterable<string>, tags: Tag[]): string[] {
  const selected = new Set(tagIds)
  return tags.filter((tag) => selected.has(tag.id)).map((tag) => tag.id)
}

function tagsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tagId, index) => tagId === right[index])
}

export class BookmarkRepository {
  /** 串行执行同一实例内的标签读改写，避免旧快照覆盖刚完成的标签变更。 */
  private tagMutationQueue: Promise<void> = Promise.resolve()

  /**
   * 将标签变更加入 FIFO 队列，使每次变更在真正执行时读取最新存储状态。
   *
   * @param mutation 需要串行执行的标签读改写操作。
   */
  private enqueueTagMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const next = this.tagMutationQueue.then(mutation, mutation)
    this.tagMutationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  async load(): Promise<CollectionSnapshot> {
    return enqueueStorageMutation(() => this.loadUnlocked())
  }

  private async loadUnlocked(): Promise<CollectionSnapshot> {
    const allItems = await getAllSyncItems()
    const current = snapshotFromItems(allItems)

    if (!current) {
      const legacy = parseLegacySnapshot(allItems)
      if (legacy) {
        const migrated = migrateLegacySnapshot(legacy)
        await this.migrateLegacyStorage(allItems, legacy, migrated)
        return clone(migrated)
      }
      const empty = createEmptyMeta()
      await this.writeItems({ [STORAGE_KEYS.meta]: empty })
      return { meta: empty, bookmarks: [] }
    }

    const embeddedTags = parseMeta(allItems[STORAGE_KEYS.meta])?.tags ?? []
    if (embeddedTags.length > 0) {
      // 兼容开发期间已经写入过的 v2 meta，并原地转成独立标签项。
      await this.writeItems({
        [STORAGE_KEYS.meta]: createEmptyMeta(),
        ...Object.fromEntries(embeddedTags.map((tag) => [tagKey(tag.id), tag])),
      })
    }
    return clone(current)
  }

  subscribe(onChange: (snapshot: CollectionSnapshot) => void, onError?: (error: Error) => void): () => void {
    const refresh = () => {
      void this.load().then(onChange).catch((error: unknown) => {
        onError?.(error instanceof Error ? error : new Error('无法读取同步数据。'))
      })
    }
    if (hasChromeSyncStorage()) {
      const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName === 'sync' && Object.keys(changes).some(isV2LinkDeckKey)) refresh()
      }
      chrome.storage.onChanged.addListener(listener)
      return () => chrome.storage.onChanged.removeListener(listener)
    }
    fallbackListeners.add(refresh)
    return () => fallbackListeners.delete(refresh)
  }

  async createTag(rawName: string): Promise<Tag> {
    const name = validateTagName(rawName)
    return enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      if (snapshot.meta.tags.some((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new UserFacingError('已有同名标签。')
      }
      const now = nextTagTimestamp(snapshot.meta.tags)
      const tag: Tag = { id: createId(), name, pinned: false, createdAt: now, updatedAt: now }
      await this.writeItems({ [tagKey(tag.id)]: tag })
      return tag
    })
  }

  async renameTag(tagId: string, rawName: string): Promise<void> {
    const name = validateTagName(rawName)
    return this.enqueueTagMutation(() => enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      const current = snapshot.meta.tags.find((tag) => tag.id === tagId)
      if (!current) throw new UserFacingError('找不到这个标签。')
      if (snapshot.meta.tags.some((tag) => tag.id !== tagId && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new UserFacingError('已有同名标签。')
      }
      await this.writeItems({ [tagKey(tagId)]: { ...current, name, updatedAt: Date.now() } })
    }))
  }

  /** 更新标签置顶状态，供筛选区优先展示常用标签。 */
  async setTagPinned(tagId: string, pinned: boolean): Promise<void> {
    return this.enqueueTagMutation(() => enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      const current = snapshot.meta.tags.find((tag) => tag.id === tagId)
      if (!current) throw new UserFacingError('找不到这个标签。')
      if (current.pinned === pinned) return
      await this.writeItems({ [tagKey(tagId)]: { ...current, pinned, updatedAt: Date.now() } })
    }))
  }

  /** 删除标签及所有关联，但绝不删除关联的收藏。 */
  async deleteTag(tagId: string): Promise<void> {
    return this.enqueueTagMutation(() => enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      if (!snapshot.meta.tags.some((tag) => tag.id === tagId)) throw new UserFacingError('找不到这个标签。')
      const now = Date.now()
      const affected = snapshot.bookmarks
        .filter((bookmark) => bookmark.tagIds.includes(tagId))
        .map((bookmark) => ({
          ...bookmark,
          tagIds: bookmark.tagIds.filter((id) => id !== tagId),
          updatedAt: now,
        }))
      await this.writeItems(Object.fromEntries(affected.map((bookmark) => [bookmarkKey(bookmark.id), bookmark])))
      await removeSyncItems([tagKey(tagId)])
    }))
  }

  async createBookmark(draft: BookmarkDraft): Promise<BookmarkSaveResult> {
    return enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      const prepared = this.prepareBookmark(snapshot, draft)
      const duplicate = snapshot.bookmarks.find((bookmark) => hasSameUrl(bookmark.url, prepared.url))
      if (duplicate) {
        const tagIds = orderedTagIds([...duplicate.tagIds, ...prepared.tagIds], prepared.tags)
        const tagsMerged = !tagsEqual(tagIds, duplicate.tagIds)
        const bookmark = tagsMerged ? { ...duplicate, tagIds, updatedAt: Date.now() } : duplicate
        await this.writeBookmarkAndTags(bookmark, prepared.newTags, tagsMerged)
        return { bookmark, created: false, tagsMerged }
      }

      const now = Date.now()
      const bookmark: Bookmark = {
        id: createId(),
        tagIds: prepared.tagIds,
        title: prepared.title,
        url: prepared.url,
        createdAt: now,
        updatedAt: now,
      }
      await this.writeBookmarkAndTags(bookmark, prepared.newTags, true)
      return { bookmark, created: true, tagsMerged: false }
    })
  }

  async updateBookmark(bookmarkId: string, draft: BookmarkDraft): Promise<Bookmark> {
    return enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      const existing = snapshot.bookmarks.find((bookmark) => bookmark.id === bookmarkId)
      if (!existing) throw new UserFacingError('找不到这个网站。')
      const prepared = this.prepareBookmark(snapshot, draft)
      if (snapshot.bookmarks.some((bookmark) => bookmark.id !== bookmarkId && hasSameUrl(bookmark.url, prepared.url))) {
        throw new UserFacingError('该网址已收藏，请编辑现有条目。')
      }
      const bookmark: Bookmark = {
        ...existing,
        tagIds: prepared.tagIds,
        title: prepared.title,
        url: prepared.url,
        updatedAt: Date.now(),
      }
      await this.writeBookmarkAndTags(bookmark, prepared.newTags, true)
      return bookmark
    })
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    return enqueueStorageMutation(async () => {
      const snapshot = await this.loadUnlocked()
      if (!snapshot.bookmarks.some((bookmark) => bookmark.id === bookmarkId)) {
        throw new UserFacingError('找不到这个网站。')
      }
      await removeSyncItems([bookmarkKey(bookmarkId)])
    })
  }

  /**
   * 导入收藏快照，并在需要时替换当前同步存储内容。
   *
   * @param imported 待导入的完整收藏快照。
   * @param mode `replace` 直接替换，`merge` 将导入内容合并到本机数据。
   * @param expectedCurrent 可选的替换前快照；用于把网络读取后的本机变更识别为冲突。
   */
  async importSnapshot(
    imported: CollectionSnapshot,
    mode: ImportMode,
    expectedCurrent?: CollectionSnapshot,
  ): Promise<ImportSummary> {
    return enqueueStorageMutation(async () => {
      const current = await this.loadUnlocked()
      if (expectedCurrent && !sameSnapshot(current, expectedCurrent)) {
        throw new UserFacingError('数据在替换期间发生变化，请重试。')
      }
      if (mode === 'replace') {
        await this.replaceSnapshot(clone(imported), current)
        return { tagsAdded: imported.meta.tags.length, bookmarksAdded: imported.bookmarks.length, bookmarksMerged: 0 }
      }
      const { snapshot, summary } = this.mergeSnapshots(current, imported)
      await this.replaceSnapshot(snapshot, current)
      return summary
    })
  }

  private prepareBookmark(snapshot: CollectionSnapshot, draft: BookmarkDraft): {
    title: string
    url: string
    tagIds: string[]
    tags: Tag[]
    newTags: Tag[]
  } {
    const url = normalizeUrl(draft.url)
    const title = validateBookmarkTitle(draft.title, url)
    const selected = new Set(draft.tagIds)
    if ([...selected].some((tagId) => !snapshot.meta.tags.some((tag) => tag.id === tagId))) {
      throw new UserFacingError('请选择有效的标签。')
    }

    const tags = clone(snapshot.meta.tags)
    const newTags: Tag[] = []
    const names = new Map(tags.map((tag) => [tag.name.toLocaleLowerCase(), tag]))
    for (const rawName of draft.newTagNames) {
      const name = validateTagName(rawName)
      const existing = names.get(name.toLocaleLowerCase())
      if (existing) {
        selected.add(existing.id)
        continue
      }
      const now = nextTagTimestamp(tags)
      const tag: Tag = { id: createId(), name, pinned: false, createdAt: now, updatedAt: now }
      tags.push(tag)
      newTags.push(tag)
      names.set(name.toLocaleLowerCase(), tag)
      selected.add(tag.id)
    }
    return {
      title,
      url,
      tagIds: orderedTagIds(selected, tags),
      tags,
      newTags,
    }
  }

  private async writeBookmarkAndTags(
    bookmark: Bookmark,
    newTags: Tag[],
    bookmarkChanged: boolean,
  ): Promise<void> {
    if (newTags.length === 0 && !bookmarkChanged) return
    const items: StorageRecord = {}
    newTags.forEach((tag) => {
      items[tagKey(tag.id)] = tag
    })
    if (bookmarkChanged) items[bookmarkKey(bookmark.id)] = bookmark
    await this.writeItems(items)
  }

  private mergeSnapshots(current: CollectionSnapshot, imported: CollectionSnapshot): {
    snapshot: CollectionSnapshot
    summary: ImportSummary
  } {
    const tags = clone(current.meta.tags)
    const tagsByName = new Map(tags.map((tag) => [tag.name.toLocaleLowerCase(), tag]))
    const importedTagIds = new Map<string, string>()
    let tagsAdded = 0

    for (const importedTag of imported.meta.tags) {
      const existing = tagsByName.get(importedTag.name.toLocaleLowerCase())
      if (existing) {
        if (importedTag.pinned && !existing.pinned) {
          existing.pinned = true
          existing.updatedAt = Math.max(existing.updatedAt, importedTag.updatedAt)
        }
        importedTagIds.set(importedTag.id, existing.id)
        continue
      }
      const tag = { ...clone(importedTag), id: createId() }
      tags.push(tag)
      tagsByName.set(tag.name.toLocaleLowerCase(), tag)
      importedTagIds.set(importedTag.id, tag.id)
      tagsAdded += 1
    }

    const bookmarks = clone(current.bookmarks)
    const byUrl = new Map(bookmarks.map((bookmark) => [normalizeUrl(bookmark.url), bookmark]))
    let bookmarksAdded = 0
    let bookmarksMerged = 0
    for (const importedBookmark of imported.bookmarks) {
      const tagIds = orderedTagIds(
        importedBookmark.tagIds.map((tagId) => importedTagIds.get(tagId)).filter((tagId): tagId is string => Boolean(tagId)),
        tags,
      )
      const existing = byUrl.get(normalizeUrl(importedBookmark.url))
      if (existing) {
        existing.tagIds = orderedTagIds([...existing.tagIds, ...tagIds], tags)
        existing.updatedAt = Math.max(existing.updatedAt, importedBookmark.updatedAt)
        bookmarksMerged += 1
        continue
      }
      const bookmark = {
        ...clone(importedBookmark),
        id: createId(),
        tagIds,
        url: normalizeUrl(importedBookmark.url),
      }
      bookmarks.push(bookmark)
      byUrl.set(bookmark.url, bookmark)
      bookmarksAdded += 1
    }
    return {
      snapshot: { meta: { schemaVersion: 2, tags }, bookmarks },
      summary: { tagsAdded, bookmarksAdded, bookmarksMerged },
    }
  }

  private async migrateLegacyStorage(
    allItems: StorageRecord,
    legacy: LegacyCollectionSnapshot,
    migrated: CollectionSnapshot,
  ): Promise<void> {
    const legacyItems = Object.fromEntries(Object.entries(allItems).filter(([key]) => isLegacyLinkDeckKey(key)))
    const preservedItems = Object.fromEntries(
      Object.entries(allItems).filter(([key]) => !isLegacyLinkDeckKey(key) && !isV2LinkDeckKey(key)),
    )
    const nextItems = snapshotItems(migrated)
    assertStorageCapacity({ ...preservedItems, ...nextItems })
    await saveMigrationBackup(legacy)
    try {
      await removeSyncItems(Object.keys(legacyItems))
      await setSyncItems(nextItems)
    } catch (error) {
      try {
        await removeSyncItems(Object.keys(nextItems))
        await setSyncItems(legacyItems)
      } catch {
        // 原始写入错误更有助于用户判断同步存储是否可用。
      }
      throw error
    }
  }

  private async writeItems(items: StorageRecord): Promise<void> {
    if (Object.keys(items).length === 0) return
    const current = await getAllSyncItems()
    assertStorageCapacity({ ...current, ...items })
    await setSyncItems(items)
  }

  private async replaceSnapshot(
    snapshot: CollectionSnapshot,
    expectedCurrent: CollectionSnapshot,
  ): Promise<void> {
    const currentItems = await getAllSyncItems()
    const currentSnapshot = snapshotFromItems(currentItems)
    if (!currentSnapshot || !sameSnapshot(currentSnapshot, expectedCurrent)) {
      throw new UserFacingError('数据在替换期间发生变化，请重试。')
    }
    const previous = Object.fromEntries(Object.entries(currentItems).filter(([key]) => isV2LinkDeckKey(key)))
    const preserved = Object.fromEntries(Object.entries(currentItems).filter(([key]) => !isV2LinkDeckKey(key)))
    const next = snapshotItems(snapshot)
    assertStorageCapacity({ ...preserved, ...next })
    const staleKeys = Object.keys(previous).filter(
      (key) => key !== STORAGE_KEYS.meta && !Object.prototype.hasOwnProperty.call(next, key),
    )
    const addedKeys = Object.keys(next).filter(
      (key) => !Object.prototype.hasOwnProperty.call(previous, key),
    )
    try {
      // meta 始终保留，订阅者只会看到旧快照的部分收藏，不会误触发空库初始化。
      await removeSyncItems(staleKeys)
      await setSyncItems(next)
    } catch (error) {
      try {
        await setSyncItems(previous)
        await removeSyncItems(addedKeys)
      } catch (rollbackError) {
        throw new UserFacingError(
          `替换失败，且无法自动恢复原数据：${rollbackError instanceof Error ? rollbackError.message : '未知错误'}`,
        )
      }
      throw error
    }
  }
}

export const bookmarkRepository = new BookmarkRepository()
