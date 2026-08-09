import {
  MAX_GROUPS,
  MAX_SYNC_ITEMS,
  STORAGE_KEYS,
  SYNC_QUOTA_BYTES,
  SYNC_QUOTA_BYTES_PER_ITEM,
  type Bookmark,
  type BookmarkDraft,
  type CollectionSnapshot,
  type Group,
  type LinkDeckMeta,
} from '../types'
import {
  UserFacingError,
  hasSameUrl,
  normalizeUrl,
  storageItemBytes,
  validateBookmarkTitle,
  validateGroupName,
} from './bookmark-utils'

type StorageRecord = Record<string, unknown>
type FallbackListener = () => void

const fallbackStorage = new Map<string, unknown>()
const fallbackListeners = new Set<FallbackListener>()

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasChromeSyncStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync)
}

async function getAllSyncItems(): Promise<StorageRecord> {
  if (hasChromeSyncStorage()) {
    return (await chrome.storage.sync.get(null)) as StorageRecord
  }

  return Object.fromEntries(
    [...fallbackStorage.entries()].map(([key, value]) => [key, clone(value)]),
  )
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
  if (hasChromeSyncStorage()) {
    await chrome.storage.sync.remove(keys)
    return
  }

  keys.forEach((key) => fallbackStorage.delete(key))
  fallbackListeners.forEach((listener) => listener())
}

async function getSyncBytesInUse(): Promise<number> {
  if (hasChromeSyncStorage()) {
    return chrome.storage.sync.getBytesInUse(null)
  }

  const allItems = await getAllSyncItems()
  return Object.entries(allItems).reduce(
    (total, [key, value]) => total + storageItemBytes(key, value),
    0,
  )
}

function createId(): string {
  return crypto.randomUUID()
}

function createDefaultMeta(): LinkDeckMeta {
  const now = Date.now()
  return {
    schemaVersion: 1,
    groups: [
      {
        id: createId(),
        name: '默认',
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

function isGroup(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Group>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number'
  )
}

function isBookmark(value: unknown): value is Bookmark {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Bookmark>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.groupId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number'
  )
}

function parseMeta(value: unknown): LinkDeckMeta | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<LinkDeckMeta>
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.groups)) return undefined
  if (!candidate.groups.every(isGroup) || candidate.groups.length === 0) return undefined
  return candidate as LinkDeckMeta
}

function bookmarkKey(id: string): string {
  return `${STORAGE_KEYS.bookmarkPrefix}${id}`
}

function groupNameExists(groups: Group[], name: string, excludedId?: string): boolean {
  const comparableName = name.toLocaleLowerCase()
  return groups.some(
    (group) =>
      group.id !== excludedId &&
      group.name.toLocaleLowerCase() === comparableName,
  )
}

export class BookmarkRepository {
  async load(): Promise<CollectionSnapshot> {
    const allItems = await getAllSyncItems()
    let meta = parseMeta(allItems[STORAGE_KEYS.meta])

    if (!meta) {
      meta = createDefaultMeta()
      await this.writeItem(STORAGE_KEYS.meta, meta, allItems)
    }

    const bookmarks = Object.entries(allItems)
      .filter(([key, value]) => key.startsWith(STORAGE_KEYS.bookmarkPrefix) && isBookmark(value))
      .map(([, value]) => value as Bookmark)
      .filter((bookmark) => meta.groups.some((group) => group.id === bookmark.groupId))
      .sort((left, right) => left.createdAt - right.createdAt)

    return { meta: clone(meta), bookmarks: clone(bookmarks) }
  }

  subscribe(onChange: (snapshot: CollectionSnapshot) => void, onError?: (error: Error) => void): () => void {
    const refresh = () => {
      void this.load().then(onChange).catch((error: unknown) => {
        onError?.(error instanceof Error ? error : new Error('无法读取同步数据。'))
      })
    }

    if (hasChromeSyncStorage()) {
      const listener = (_changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName === 'sync') refresh()
      }
      chrome.storage.onChanged.addListener(listener)
      return () => chrome.storage.onChanged.removeListener(listener)
    }

    fallbackListeners.add(refresh)
    return () => fallbackListeners.delete(refresh)
  }

  async createGroup(rawName: string): Promise<Group> {
    const name = validateGroupName(rawName)
    const { meta } = await this.load()

    if (meta.groups.length >= MAX_GROUPS) {
      throw new UserFacingError(`最多只能创建 ${MAX_GROUPS} 个分组。`)
    }

    if (groupNameExists(meta.groups, name)) {
      throw new UserFacingError('已有同名分组。')
    }

    const now = Date.now()
    const group: Group = { id: createId(), name, createdAt: now, updatedAt: now }
    await this.writeMeta({ ...meta, groups: [...meta.groups, group] })
    return group
  }

  async renameGroup(groupId: string, rawName: string): Promise<void> {
    const name = validateGroupName(rawName)
    const { meta } = await this.load()
    const current = meta.groups.find((group) => group.id === groupId)

    if (!current) throw new UserFacingError('找不到这个分组。')
    if (groupNameExists(meta.groups, name, groupId)) {
      throw new UserFacingError('已有同名分组。')
    }

    await this.writeMeta({
      ...meta,
      groups: meta.groups.map((group) =>
        group.id === groupId ? { ...group, name, updatedAt: Date.now() } : group,
      ),
    })
  }

  async deleteGroup(groupId: string): Promise<void> {
    const snapshot = await this.load()
    if (snapshot.meta.groups.length <= 1) {
      throw new UserFacingError('至少需要保留一个分组。')
    }

    if (!snapshot.meta.groups.some((group) => group.id === groupId)) {
      throw new UserFacingError('找不到这个分组。')
    }

    if (snapshot.bookmarks.some((bookmark) => bookmark.groupId === groupId)) {
      throw new UserFacingError('分组内还有网站，请先移动或删除它们。')
    }

    await this.writeMeta({
      ...snapshot.meta,
      groups: snapshot.meta.groups.filter((group) => group.id !== groupId),
    })
  }

  async createBookmark(draft: BookmarkDraft): Promise<Bookmark> {
    const snapshot = await this.load()
    const bookmark = this.buildBookmark(draft, snapshot)
    await this.writeItem(bookmarkKey(bookmark.id), bookmark)
    return bookmark
  }

  async updateBookmark(bookmarkId: string, draft: BookmarkDraft): Promise<void> {
    const snapshot = await this.load()
    const existing = snapshot.bookmarks.find((bookmark) => bookmark.id === bookmarkId)
    if (!existing) throw new UserFacingError('找不到这个网站。')

    const updated = this.buildBookmark(draft, snapshot, existing)
    await this.writeItem(bookmarkKey(bookmarkId), updated)
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    const snapshot = await this.load()
    if (!snapshot.bookmarks.some((bookmark) => bookmark.id === bookmarkId)) {
      throw new UserFacingError('找不到这个网站。')
    }
    await removeSyncItems([bookmarkKey(bookmarkId)])
  }

  private buildBookmark(
    draft: BookmarkDraft,
    snapshot: CollectionSnapshot,
    existing?: Bookmark,
  ): Bookmark {
    const url = normalizeUrl(draft.url)
    const title = validateBookmarkTitle(draft.title, url)

    if (!snapshot.meta.groups.some((group) => group.id === draft.groupId)) {
      throw new UserFacingError('请选择有效的分组。')
    }

    const duplicate = snapshot.bookmarks.some(
      (bookmark) =>
        bookmark.id !== existing?.id &&
        bookmark.groupId === draft.groupId &&
        hasSameUrl(bookmark.url, url),
    )
    if (duplicate) {
      throw new UserFacingError('这个分组已收藏过该网址。')
    }

    const now = Date.now()
    return {
      id: existing?.id ?? createId(),
      groupId: draft.groupId,
      title,
      url,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  }

  private async writeMeta(meta: LinkDeckMeta): Promise<void> {
    await this.writeItem(STORAGE_KEYS.meta, meta)
  }

  private async writeItem(key: string, value: unknown, knownItems?: StorageRecord): Promise<void> {
    const itemBytes = storageItemBytes(key, value)
    if (itemBytes > SYNC_QUOTA_BYTES_PER_ITEM) {
      throw new UserFacingError('单条数据太大，无法同步保存。')
    }

    const allItems = knownItems ?? (await getAllSyncItems())
    const exists = Object.prototype.hasOwnProperty.call(allItems, key)
    if (!exists && Object.keys(allItems).length >= MAX_SYNC_ITEMS) {
      throw new UserFacingError('同步存储已达到项目数量上限。')
    }

    const currentBytes = await getSyncBytesInUse()
    const previousBytes = exists ? storageItemBytes(key, allItems[key]) : 0
    if (currentBytes - previousBytes + itemBytes > SYNC_QUOTA_BYTES) {
      throw new UserFacingError('浏览器同步存储空间不足，无法保存。')
    }

    try {
      await setSyncItems({ [key]: value })
    } catch {
      throw new UserFacingError('保存失败，请检查浏览器同步设置后重试。')
    }
  }
}

export const bookmarkRepository = new BookmarkRepository()
