import type {
  Bookmark,
  CollectionSnapshot,
  LegacyCollectionSnapshot,
} from '../types'
import { normalizeUrl } from './bookmark-utils'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableLatest<T extends { id: string; updatedAt: number }>(items: T[]): T {
  return [...items].sort((left, right) =>
    right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  )[0]!
}

/**
 * 将 v1 的单分组收藏转换为 v2 多标签快照。
 *
 * 同一网址会确定性地合并为一条收藏，避免不同设备迁移后生成不同实体 ID。
 */
export function migrateLegacySnapshot(legacy: LegacyCollectionSnapshot): CollectionSnapshot {
  const tags = clone(legacy.meta.groups)
  const tagOrder = new Map(tags.map((tag, index) => [tag.id, index]))
  const byUrl = new Map<string, typeof legacy.bookmarks>()

  for (const bookmark of legacy.bookmarks) {
    const url = normalizeUrl(bookmark.url)
    byUrl.set(url, [...(byUrl.get(url) ?? []), bookmark])
  }

  const bookmarks: Bookmark[] = [...byUrl.entries()].map(([url, candidates]) => {
    const selected = stableLatest(candidates)
    const tagIds = [...new Set(candidates.map((bookmark) => bookmark.groupId))]
      .sort((left, right) => (tagOrder.get(left) ?? 0) - (tagOrder.get(right) ?? 0))

    return {
      id: selected.id,
      tagIds,
      title: selected.title,
      url,
      createdAt: Math.min(...candidates.map((bookmark) => bookmark.createdAt)),
      updatedAt: Math.max(...candidates.map((bookmark) => bookmark.updatedAt)),
    }
  })

  return {
    meta: { schemaVersion: 2, tags },
    bookmarks: bookmarks.sort((left, right) => left.createdAt - right.createdAt),
  }
}
