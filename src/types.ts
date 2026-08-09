export const MAX_GROUPS = 30
export const MAX_GROUP_NAME_LENGTH = 24
export const MAX_BOOKMARK_TITLE_LENGTH = 80
export const MAX_URL_LENGTH = 2048
export const MAX_SYNC_ITEMS = 512
export const SYNC_QUOTA_BYTES = 102_400
export const SYNC_QUOTA_BYTES_PER_ITEM = 8_192

export const STORAGE_KEYS = {
  meta: 'linkdeck:meta',
  bookmarkPrefix: 'linkdeck:bookmark:',
  selectedGroup: 'linkdeck:selected-group',
} as const

export type Group = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type Bookmark = {
  id: string
  groupId: string
  title: string
  url: string
  createdAt: number
  updatedAt: number
}

export type LinkDeckMeta = {
  schemaVersion: 1
  groups: Group[]
}

export type BookmarkDraft = {
  title: string
  url: string
  groupId: string
}

export type CollectionSnapshot = {
  meta: LinkDeckMeta
  bookmarks: Bookmark[]
}

