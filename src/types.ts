export const MAX_TAG_NAME_LENGTH = 24
export const MAX_BOOKMARK_TITLE_LENGTH = 80
export const MAX_URL_LENGTH = 2048
export const MAX_SYNC_ITEMS = 512
export const SYNC_QUOTA_BYTES = 102_400
export const SYNC_QUOTA_BYTES_PER_ITEM = 8_192

/** 当前标签数据使用独立键空间，避免旧版分组客户端误写新数据。 */
export const STORAGE_KEYS = {
  meta: 'linkdeck:v2:meta',
  tagPrefix: 'linkdeck:v2:tag:',
  bookmarkPrefix: 'linkdeck:v2:bookmark:',
  tagFilter: 'linkdeck:selected-tag-filter',
  migrationBackup: 'linkdeck:migration-backup:v1',
  legacyMeta: 'linkdeck:meta',
  legacyBookmarkPrefix: 'linkdeck:bookmark:',
  legacySelectedGroup: 'linkdeck:selected-group',
} as const

/** 用户用于整理链接的可复用标签。 */
export type Tag = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/** 一条网址收藏，可同时关联零个或多个标签。 */
export type Bookmark = {
  id: string
  tagIds: string[]
  title: string
  url: string
  createdAt: number
  updatedAt: number
}

/** v2 收藏元数据。空标签列表代表用户尚未建立分类。 */
export type LinkDeckMeta = {
  schemaVersion: 2
  tags: Tag[]
}

/** 标签输入框提交的、尚未持久化的新标签名称。 */
export type BookmarkDraft = {
  title: string
  url: string
  tagIds: string[]
  newTagNames: string[]
}

export type CollectionSnapshot = {
  meta: LinkDeckMeta
  bookmarks: Bookmark[]
}

export type ImportMode = 'replace' | 'merge'

export type ImportSummary = {
  tagsAdded: number
  bookmarksAdded: number
  bookmarksMerged: number
}

export type BookmarkSaveResult = {
  bookmark: Bookmark
  created: boolean
  tagsMerged: boolean
}

/** Popup 本地保存的标签筛选状态。 */
export type TagFilter = {
  tagIds: string[]
  untaggedOnly: boolean
}

/** 仅用于读取并迁移旧版分组数据，不能写回 v2 存储。 */
export type LegacyGroup = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type LegacyBookmark = {
  id: string
  groupId: string
  title: string
  url: string
  createdAt: number
  updatedAt: number
}

export type LegacyCollectionSnapshot = {
  meta: {
    schemaVersion: 1
    groups: LegacyGroup[]
  }
  bookmarks: LegacyBookmark[]
}
