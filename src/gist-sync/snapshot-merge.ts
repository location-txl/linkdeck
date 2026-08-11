import type { Bookmark, CollectionSnapshot, Tag } from '../types'
import { normalizeUrl } from '../lib/bookmark-utils'
import type { ConflictChoice } from './types'

export type ThreeWayMergeResult = {
  snapshot: CollectionSnapshot
  conflicts: string[]
}

type MergeEntity<T> = T | undefined

type TagDeletionConflict = {
  tagId: string
  message: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function allIds<T extends { id: string }>(...groups: T[][]): string[] {
  return [...new Set(groups.flatMap((items) => items.map((item) => item.id)))].sort()
}

function sameTag(left: MergeEntity<Tag>, right: MergeEntity<Tag>): boolean {
  if (!left || !right) return left === right
  return left.id === right.id && left.name === right.name &&
    (left.pinned === true) === (right.pinned === true) && left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
}

/** 合并标签的独立字段，避免重命名与置顶同时发生时制造无意义冲突。 */
function mergeTag(
  base: MergeEntity<Tag>,
  local: MergeEntity<Tag>,
  remote: MergeEntity<Tag>,
  conflicts: string[],
  choice?: ConflictChoice,
): MergeEntity<Tag> {
  if (!base || !local || !remote) {
    return chooseEntity(
      base,
      local,
      remote,
      sameTag,
      conflicts,
      `标签“${local?.name ?? remote?.name ?? base?.name ?? '未知'}”被两端以不同方式修改。`,
      choice,
    )
  }

  const resolve = <T>(baseValue: T, localValue: T, remoteValue: T): { value: T; conflicted: boolean } => {
    if (localValue === remoteValue) return { value: localValue, conflicted: false }
    if (localValue === baseValue) return { value: remoteValue, conflicted: false }
    if (remoteValue === baseValue) return { value: localValue, conflicted: false }
    return { value: choice === 'remote' ? remoteValue : localValue, conflicted: true }
  }
  const name = resolve(base.name, local.name, remote.name)
  const pinned = resolve(base.pinned, local.pinned, remote.pinned)
  if (name.conflicted || pinned.conflicted) {
    conflicts.push(`标签“${local.name}”被两端以不同方式修改。`)
  }
  return {
    ...base,
    name: name.value,
    pinned: pinned.value,
    updatedAt: Math.max(base.updatedAt, local.updatedAt, remote.updatedAt),
  }
}

function sameBookmarkContent(left: MergeEntity<Bookmark>, right: MergeEntity<Bookmark>): boolean {
  if (!left || !right) return left === right
  return left.id === right.id && left.title === right.title && left.url === right.url &&
    left.createdAt === right.createdAt
}

function sameBookmark(left: MergeEntity<Bookmark>, right: MergeEntity<Bookmark>): boolean {
  if (!sameBookmarkContent(left, right)) return false
  return JSON.stringify([...left!.tagIds].sort()) === JSON.stringify([...right!.tagIds].sort()) &&
    left!.updatedAt === right!.updatedAt
}

function chooseEntity<T>(
  base: MergeEntity<T>,
  local: MergeEntity<T>,
  remote: MergeEntity<T>,
  equals: (left: MergeEntity<T>, right: MergeEntity<T>) => boolean,
  conflicts: string[],
  message: string,
  choice?: ConflictChoice,
): MergeEntity<T> {
  if (equals(local, remote)) return local
  if (equals(local, base)) return remote
  if (equals(remote, base)) return local
  conflicts.push(message)
  return choice === 'remote' ? remote : local
}

function orderedTagIds(tagIds: Iterable<string>, tags: Tag[]): string[] {
  const selected = new Set(tagIds)
  return tags.filter((tag) => selected.has(tag.id)).map((tag) => tag.id)
}

function mergeTagMembership(base: string[], local: string[], remote: string[]): string[] {
  const baseSet = new Set(base)
  const localSet = new Set(local)
  const remoteSet = new Set(remote)
  const ids = new Set([...base, ...local, ...remote])
  const result: string[] = []
  for (const id of ids) {
    const baseHas = baseSet.has(id)
    const localHas = localSet.has(id)
    const remoteHas = remoteSet.has(id)
    if (localHas === remoteHas || localHas === baseHas) {
      if (remoteHas) result.push(id)
    } else if (remoteHas === baseHas) {
      if (localHas) result.push(id)
    }
  }
  return result
}

/**
 * 标签实体被删除而另一端仍在链接上引用时，不能把它当成普通的成员关系删除。
 *
 * 用户选择来源后，标签实体和所有相关链接的成员关系必须一起采用同一侧，
 * 否则会出现“标签恢复了、链接却没恢复”的半完成状态。
 */
function findTagDeletionConflicts(
  baseTags: Map<string, Tag>,
  localTags: Map<string, Tag>,
  remoteTags: Map<string, Tag>,
  localBookmarks: Bookmark[],
  remoteBookmarks: Bookmark[],
): TagDeletionConflict[] {
  const conflicts: TagDeletionConflict[] = []
  for (const tag of baseTags.values()) {
    const localDeleted = !localTags.has(tag.id)
    const remoteDeleted = !remoteTags.has(tag.id)
    if (localDeleted === remoteDeleted) continue

    const keptBookmarks = localDeleted ? remoteBookmarks : localBookmarks
    if (!keptBookmarks.some((bookmark) => bookmark.tagIds.includes(tag.id))) continue
    conflicts.push({
      tagId: tag.id,
      message: `标签“${tag.name}”一端删除、另一端仍有链接使用它。`,
    })
  }
  return conflicts
}

function applyTagDeletionChoice(
  tags: Tag[],
  bookmarks: Bookmark[],
  conflicts: TagDeletionConflict[],
  localTags: Map<string, Tag>,
  remoteTags: Map<string, Tag>,
  localBookmarks: Map<string, Bookmark>,
  remoteBookmarks: Map<string, Bookmark>,
  choice?: ConflictChoice,
): { tags: Tag[]; bookmarks: Bookmark[] } {
  if (!choice || conflicts.length === 0) return { tags, bookmarks }

  let nextTags = [...tags]
  let nextBookmarks = [...bookmarks]
  const sourceTags = choice === 'remote' ? remoteTags : localTags
  const sourceBookmarks = choice === 'remote' ? remoteBookmarks : localBookmarks

  for (const conflict of conflicts) {
    const selectedTag = sourceTags.get(conflict.tagId)
    if (!selectedTag) {
      nextTags = nextTags.filter((tag) => tag.id !== conflict.tagId)
      nextBookmarks = nextBookmarks.map((bookmark) => ({
        ...bookmark,
        tagIds: bookmark.tagIds.filter((tagId) => tagId !== conflict.tagId),
      }))
      continue
    }

    if (!nextTags.some((tag) => tag.id === selectedTag.id)) nextTags.push(clone(selectedTag))
    nextBookmarks = nextBookmarks.map((bookmark) => {
      const selectedBookmark = sourceBookmarks.get(bookmark.id)
      const usesTag = selectedBookmark?.tagIds.includes(conflict.tagId) ?? false
      return {
        ...bookmark,
        tagIds: usesTag
          ? [...new Set([...bookmark.tagIds, conflict.tagId])]
          : bookmark.tagIds.filter((tagId) => tagId !== conflict.tagId),
      }
    })
  }
  return { tags: nextTags, bookmarks: nextBookmarks }
}

function collapseDuplicateTags(
  tags: Tag[],
  local: Map<string, Tag>,
  remote: Map<string, Tag>,
  conflicts: string[],
  choice?: ConflictChoice,
): { tags: Tag[]; remappedIds: Map<string, string> } {
  const byName = new Map<string, Tag[]>()
  tags.forEach((tag) => byName.set(tag.name.toLocaleLowerCase(), [...(byName.get(tag.name.toLocaleLowerCase()) ?? []), tag]))
  const duplicates = [...byName.entries()].filter(([, candidates]) => candidates.length > 1)
  if (duplicates.length === 0) return { tags, remappedIds: new Map() }

  const remappedIds = new Map<string, string>()
  duplicates.forEach(([name]) => {
    conflicts.push(`两端并发创建了同名标签“${name}”。`)
  })

  if (!choice) {
    const kept = [...byName.values()].map((candidates) => {
      const target = [...candidates].sort((left, right) => left.id.localeCompare(right.id))[0]!
      candidates.forEach((tag) => remappedIds.set(tag.id, target.id))
      return target
    })
    return { tags: kept, remappedIds }
  }

  const source = choice === 'remote' ? remote : local
  const collisionIds = new Set(duplicates.flatMap(([, candidates]) => candidates.map((tag) => tag.id)))
  const kept = tags.filter((tag) => !collisionIds.has(tag.id))
  for (const [, candidates] of duplicates) {
    const selected = candidates
      .map((candidate) => source.get(candidate.id))
      .filter((tag): tag is Tag => Boolean(tag))
    selected.forEach((tag) => {
      if (!kept.some((candidate) => candidate.id === tag.id)) kept.push(clone(tag))
    })
    for (const candidate of candidates) {
      if (selected.some((tag) => tag.id === candidate.id)) continue
      const target = selected.find((tag) =>
        tag.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase(),
      )
      if (target) remappedIds.set(candidate.id, target.id)
    }
  }

  // 所选侧本身名称唯一；另一侧新增项若撞名，统一映射到所选侧实体。
  const normalized: Tag[] = []
  const normalizedByName = new Map<string, Tag>()
  for (const tag of kept) {
    const name = tag.name.toLocaleLowerCase()
    const existing = normalizedByName.get(name)
    if (!existing) {
      normalized.push(tag)
      normalizedByName.set(name, tag)
      continue
    }
    const sourceTag = source.get(tag.id)
    const sourceExisting = source.get(existing.id)
    const preferred = sourceTag && sameTag(sourceTag, tag) ? tag
      : sourceExisting && sameTag(sourceExisting, existing) ? existing
        : existing
    const removed = preferred.id === existing.id ? tag : existing
    remappedIds.set(removed.id, preferred.id)
    if (preferred.id !== existing.id) {
      normalized.splice(normalized.indexOf(existing), 1, preferred)
      normalizedByName.set(name, preferred)
    }
  }
  return { tags: normalized, remappedIds }
}

function mergeBookmark(
  base: MergeEntity<Bookmark>,
  local: MergeEntity<Bookmark>,
  remote: MergeEntity<Bookmark>,
  conflicts: string[],
  choice?: ConflictChoice,
): MergeEntity<Bookmark> {
  if (!base) {
    if (!local || !remote) return local ?? remote
    if (!sameBookmarkContent(local, remote)) {
      conflicts.push(`网址“${local.title}”被两端以不同内容新增。`)
      return choice === 'remote' ? remote : local
    }
    return {
      ...local,
      tagIds: mergeTagMembership([], local.tagIds, remote.tagIds),
      updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    }
  }

  if (!local || !remote) {
    const present = local ?? remote
    if (!present) return undefined
    if (sameBookmark(base, present)) return undefined
    conflicts.push(`收藏“${present.title}”一端删除、另一端修改。`)
    return choice === 'remote' ? remote : local
  }

  const content = chooseEntity(
    base,
    local,
    remote,
    sameBookmarkContent,
    conflicts,
    `收藏“${local.title}”被两端以不同方式修改。`,
    choice,
  )!
  const tagIds = mergeTagMembership(base.tagIds, local.tagIds, remote.tagIds)
  return {
    ...content,
    tagIds,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  }
}

function collapseDuplicateBookmarks(
  bookmarks: Bookmark[],
  base: Map<string, Bookmark>,
  local: Map<string, Bookmark>,
  remote: Map<string, Bookmark>,
  conflicts: string[],
  choice?: ConflictChoice,
): Bookmark[] {
  const byUrl = new Map<string, Bookmark[]>()
  bookmarks.forEach((bookmark) => {
    const url = normalizeUrl(bookmark.url)
    byUrl.set(url, [...(byUrl.get(url) ?? []), bookmark])
  })
  const kept: Bookmark[] = []
  for (const [url, candidates] of byUrl) {
    if (candidates.length === 1) {
      kept.push(candidates[0]!)
      continue
    }
    const hasExistingEntity = candidates.some((bookmark) => base.has(bookmark.id))
    if (hasExistingEntity) {
      conflicts.push(`已有收藏被两端修改为同一网址“${url}”。`)
      if (choice) {
        const source = choice === 'remote' ? remote : local
        const selected = candidates
          .map((candidate) => source.get(candidate.id))
          .filter((bookmark): bookmark is Bookmark => Boolean(bookmark))
        kept.push(...selected.map(clone))
      } else {
        kept.push([...candidates].sort((left, right) => left.id.localeCompare(right.id))[0]!)
      }
      continue
    }

    const sameContent = candidates.every((bookmark) =>
      bookmark.title === candidates[0]!.title && bookmark.url === candidates[0]!.url,
    )
    if (!sameContent) conflicts.push(`同一网址“${url}”被两端以不同标题新增。`)
    const preferred = choice === 'remote'
      ? candidates.find((bookmark) => remote.has(bookmark.id))
      : candidates.find((bookmark) => local.has(bookmark.id))
    const selected = preferred ?? [...candidates].sort((left, right) =>
      right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    )[0]!
    kept.push({
      ...selected,
      tagIds: [...new Set(candidates.flatMap((bookmark) => bookmark.tagIds))],
      createdAt: Math.min(...candidates.map((bookmark) => bookmark.createdAt)),
      updatedAt: Math.max(...candidates.map((bookmark) => bookmark.updatedAt)),
    })
  }
  return kept
}

function restoreMissingTags(
  tags: Tag[],
  bookmarks: Bookmark[],
  localTags: Map<string, Tag>,
  remoteTags: Map<string, Tag>,
  conflicts: string[],
  choice?: ConflictChoice,
  reportedTagIds = new Set<string>(),
): { tags: Tag[]; bookmarks: Bookmark[] } {
  const available = new Map(tags.map((tag) => [tag.id, tag]))
  const selectedTags = choice === 'remote' ? remoteTags : localTags
  const restoredById = new Map<string, string>()

  const normalized = bookmarks.map((bookmark) => {
    const tagIds: string[] = []
    for (const tagId of bookmark.tagIds) {
      const restored = restoredById.get(tagId)
      if (restored) {
        tagIds.push(restored)
        continue
      }
      if (available.has(tagId)) {
        tagIds.push(tagId)
        continue
      }
      if (!reportedTagIds.has(tagId)) {
        conflicts.push(`收藏“${bookmark.title}”引用了被另一端删除的标签。`)
      }
      if (!choice) continue
      const source = selectedTags.get(tagId)
      if (!source) continue
      const sameName = tags.find((tag) => tag.name.toLocaleLowerCase() === source.name.toLocaleLowerCase())
      const target = sameName ?? clone(source)
      if (!sameName) {
        tags.push(target)
        available.set(target.id, target)
      }
      restoredById.set(tagId, target.id)
      tagIds.push(target.id)
    }
    return { ...bookmark, tagIds: [...new Set(tagIds)] }
  })
  return { tags, bookmarks: normalized }
}

/**
 * 以最后一次同步快照为共同基线合并两端改动。
 *
 * 标签成员关系逐项合并；同一收藏的标题或网址双边改动才需要用户选择。
 */
export function mergeThreeWaySnapshots(
  base: CollectionSnapshot,
  local: CollectionSnapshot,
  remote: CollectionSnapshot,
  choice?: ConflictChoice,
): ThreeWayMergeResult {
  const conflicts: string[] = []
  const baseTags = mapById(base.meta.tags)
  const localTags = mapById(local.meta.tags)
  const remoteTags = mapById(remote.meta.tags)
  const tagDeletionConflicts = findTagDeletionConflicts(
    baseTags,
    localTags,
    remoteTags,
    local.bookmarks,
    remote.bookmarks,
  )
  tagDeletionConflicts.forEach((conflict) => conflicts.push(conflict.message))
  const mergedTags = allIds(base.meta.tags, local.meta.tags, remote.meta.tags)
    .map((id) => mergeTag(
      baseTags.get(id),
      localTags.get(id),
      remoteTags.get(id),
      conflicts,
      choice,
    ))
    .filter((tag): tag is Tag => Boolean(tag))
  const normalizedTags = collapseDuplicateTags(mergedTags, localTags, remoteTags, conflicts, choice)

  const baseBookmarks = mapById(base.bookmarks)
  const localBookmarks = mapById(local.bookmarks)
  const remoteBookmarks = mapById(remote.bookmarks)
  const mergedBookmarks = allIds(base.bookmarks, local.bookmarks, remote.bookmarks)
    .map((id) => mergeBookmark(baseBookmarks.get(id), localBookmarks.get(id), remoteBookmarks.get(id), conflicts, choice))
    .filter((bookmark): bookmark is Bookmark => Boolean(bookmark))
    .map((bookmark) => ({
      ...bookmark,
      tagIds: bookmark.tagIds.map((tagId) => normalizedTags.remappedIds.get(tagId) ?? tagId),
    }))

  const withUniqueUrls = collapseDuplicateBookmarks(
    mergedBookmarks,
    baseBookmarks,
    localBookmarks,
    remoteBookmarks,
    conflicts,
    choice,
  )
  const deletionChoice = applyTagDeletionChoice(
    normalizedTags.tags,
    withUniqueUrls,
    tagDeletionConflicts,
    localTags,
    remoteTags,
    localBookmarks,
    remoteBookmarks,
    choice,
  )
  const restored = restoreMissingTags(
    deletionChoice.tags,
    deletionChoice.bookmarks,
    localTags,
    remoteTags,
    conflicts,
    choice,
    new Set(tagDeletionConflicts.map((conflict) => conflict.tagId)),
  )
  const tags = restored.tags.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  const bookmarks = restored.bookmarks
    .map((bookmark) => ({ ...bookmark, tagIds: orderedTagIds(bookmark.tagIds, tags) }))
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  return { snapshot: { meta: { schemaVersion: 2, tags }, bookmarks }, conflicts }
}

/** 对首次绑定时没有共同基线的两份快照执行保守并集。 */
export function mergeInitialSnapshots(local: CollectionSnapshot, remote: CollectionSnapshot): CollectionSnapshot {
  const tags = clone(local.meta.tags)
  const tagsByName = new Map(tags.map((tag) => [tag.name.toLocaleLowerCase(), tag]))
  const remoteTagIds = new Map<string, string>()
  for (const remoteTag of remote.meta.tags) {
    const existing = tagsByName.get(remoteTag.name.toLocaleLowerCase())
    if (existing) {
      if (remoteTag.pinned && !existing.pinned) {
        existing.pinned = true
        existing.updatedAt = Math.max(existing.updatedAt, remoteTag.updatedAt)
      }
      remoteTagIds.set(remoteTag.id, existing.id)
      continue
    }
    const tag = { ...clone(remoteTag), id: crypto.randomUUID() }
    tags.push(tag)
    tagsByName.set(tag.name.toLocaleLowerCase(), tag)
    remoteTagIds.set(remoteTag.id, tag.id)
  }

  const bookmarks = clone(local.bookmarks)
  const byUrl = new Map(bookmarks.map((bookmark) => [normalizeUrl(bookmark.url), bookmark]))
  for (const remoteBookmark of remote.bookmarks) {
    const tagIds = remoteBookmark.tagIds
      .map((tagId) => remoteTagIds.get(tagId))
      .filter((tagId): tagId is string => Boolean(tagId))
    const existing = byUrl.get(normalizeUrl(remoteBookmark.url))
    if (existing) {
      existing.tagIds = orderedTagIds([...existing.tagIds, ...tagIds], tags)
      existing.updatedAt = Math.max(existing.updatedAt, remoteBookmark.updatedAt)
      continue
    }
    const bookmark = { ...clone(remoteBookmark), id: crypto.randomUUID(), tagIds }
    bookmarks.push(bookmark)
    byUrl.set(normalizeUrl(bookmark.url), bookmark)
  }
  return { meta: { schemaVersion: 2, tags }, bookmarks }
}

/** 忽略集合顺序比较完整快照，避免无关排序触发重复同步。 */
export function sameSnapshot(left: CollectionSnapshot, right: CollectionSnapshot): boolean {
  const sortById = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
  const normalized = (snapshot: CollectionSnapshot) => ({
    meta: {
      schemaVersion: snapshot.meta.schemaVersion,
      tags: sortById(snapshot.meta.tags).map((tag) => ({
        id: tag.id,
        name: tag.name,
        pinned: tag.pinned === true,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      })),
    },
    bookmarks: sortById(snapshot.bookmarks).map((bookmark) => ({
      id: bookmark.id,
      tagIds: [...bookmark.tagIds].sort(),
      title: bookmark.title,
      url: bookmark.url,
      createdAt: bookmark.createdAt,
      updatedAt: bookmark.updatedAt,
    })),
  })
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}
