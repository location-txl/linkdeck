import { normalizeUrl } from '../lib/bookmark-utils'
import type { Bookmark, CollectionSnapshot, Group } from '../types'
import type { ConflictChoice } from './types'

type MergeEntity<T> = T | undefined

/** 三方合并的结果；冲突存在时 snapshot 仅用于预览，不能直接写入。 */
export type ThreeWayMergeResult = {
  snapshot: CollectionSnapshot
  conflicts: string[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sameGroup(left: MergeEntity<Group>, right: MergeEntity<Group>): boolean {
  if (!left || !right) return left === right
  return left.id === right.id && left.name === right.name && left.createdAt === right.createdAt
}

function sameBookmark(left: MergeEntity<Bookmark>, right: MergeEntity<Bookmark>): boolean {
  if (!left || !right) return left === right
  return (
    left.id === right.id &&
    left.groupId === right.groupId &&
    left.title === right.title &&
    left.url === right.url &&
    left.createdAt === right.createdAt
  )
}

function sameEntity<T>(
  base: MergeEntity<T>,
  local: MergeEntity<T>,
  remote: MergeEntity<T>,
  compare: (left: MergeEntity<T>, right: MergeEntity<T>) => boolean,
  conflicts: string[],
  label: string,
  choice?: ConflictChoice,
): MergeEntity<T> {
  if (compare(local, remote)) return local ? clone(local) : undefined
  if (compare(base, local)) return remote ? clone(remote) : undefined
  if (compare(base, remote)) return local ? clone(local) : undefined
  conflicts.push(label)
  const selected = choice === 'remote' ? remote : local
  return selected ? clone(selected) : undefined
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function allIds<T extends { id: string }>(...lists: T[][]): string[] {
  const ids: string[] = []
  const known = new Set<string>()
  for (const list of lists) {
    for (const item of list) {
      if (!known.has(item.id)) {
        known.add(item.id)
        ids.push(item.id)
      }
    }
  }
  return ids
}

function preferredGroupId(
  ids: string[],
  local: Map<string, Group>,
  remote: Map<string, Group>,
  choice?: ConflictChoice,
): string {
  const preferred = choice === 'remote' ? remote : local
  return ids.find((id) => preferred.has(id)) ?? ids[0]!
}

function collapseDuplicateGroups(
  groups: Group[],
  local: Map<string, Group>,
  remote: Map<string, Group>,
  conflicts: string[],
  choice?: ConflictChoice,
): { groups: Group[]; remappedIds: Map<string, string> } {
  const byName = new Map<string, Group[]>()
  for (const group of groups) {
    const key = group.name.toLocaleLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), group])
  }

  const remappedIds = new Map<string, string>()
  const kept: Group[] = []
  for (const [name, candidates] of byName) {
    if (candidates.length === 1) {
      kept.push(candidates[0]!)
      continue
    }
    conflicts.push(`并发创建了同名分组“${name}”。`)
    const targetId = preferredGroupId(candidates.map((group) => group.id), local, remote, choice)
    const target = candidates.find((group) => group.id === targetId)!
    kept.push(target)
    candidates.forEach((group) => remappedIds.set(group.id, target.id))
  }
  return { groups: kept, remappedIds }
}

function collapseDuplicateBookmarks(
  bookmarks: Bookmark[],
  local: Map<string, Bookmark>,
  remote: Map<string, Bookmark>,
  conflicts: string[],
  choice?: ConflictChoice,
): Bookmark[] {
  const byUrl = new Map<string, Bookmark[]>()
  for (const bookmark of bookmarks) {
    const key = `${bookmark.groupId}\n${normalizeUrl(bookmark.url)}`
    byUrl.set(key, [...(byUrl.get(key) ?? []), bookmark])
  }

  const kept: Bookmark[] = []
  for (const candidates of byUrl.values()) {
    if (candidates.length === 1) {
      kept.push(candidates[0]!)
      continue
    }
    const first = candidates[0]!
    const identical = candidates.every(
      (bookmark) => bookmark.title === first.title && normalizeUrl(bookmark.url) === normalizeUrl(first.url),
    )
    if (!identical) {
      conflicts.push(`同一分组中的网址“${normalizeUrl(first.url)}”被两端以不同内容新增。`)
    }
    const preferred = choice === 'remote' ? remote : local
    kept.push(candidates.find((bookmark) => preferred.has(bookmark.id)) ?? first)
  }
  return kept
}

/**
 * 以最后一次同步快照为基线合并两端改动。
 *
 * 同一实体仅有一端修改时自动采用该修改；两个不同修改会记录为冲突。choice
 * 只在用户已选择统一来源时传入，用于产出可写入的最终快照。
 */
export function mergeThreeWaySnapshots(
  base: CollectionSnapshot,
  local: CollectionSnapshot,
  remote: CollectionSnapshot,
  choice?: ConflictChoice,
): ThreeWayMergeResult {
  const conflicts: string[] = []
  const baseGroups = mapById(base.meta.groups)
  const localGroups = mapById(local.meta.groups)
  const remoteGroups = mapById(remote.meta.groups)

  const mergedGroups = allIds(base.meta.groups, local.meta.groups, remote.meta.groups)
    .map((id) =>
      sameEntity(
        baseGroups.get(id),
        localGroups.get(id),
        remoteGroups.get(id),
        sameGroup,
        conflicts,
        `分组“${localGroups.get(id)?.name ?? remoteGroups.get(id)?.name ?? baseGroups.get(id)?.name ?? id}”被两端以不同方式修改。`,
        choice,
      ),
    )
    .filter((group): group is Group => Boolean(group))

  const normalizedGroups = collapseDuplicateGroups(
    mergedGroups,
    localGroups,
    remoteGroups,
    conflicts,
    choice,
  )
  const groupIds = new Set(normalizedGroups.groups.map((group) => group.id))

  const baseBookmarks = mapById(base.bookmarks)
  const localBookmarks = mapById(local.bookmarks)
  const remoteBookmarks = mapById(remote.bookmarks)
  const mergedBookmarks = allIds(base.bookmarks, local.bookmarks, remote.bookmarks)
    .map((id) =>
      sameEntity(
        baseBookmarks.get(id),
        localBookmarks.get(id),
        remoteBookmarks.get(id),
        sameBookmark,
        conflicts,
        `收藏“${localBookmarks.get(id)?.title ?? remoteBookmarks.get(id)?.title ?? baseBookmarks.get(id)?.title ?? id}”被两端以不同方式修改。`,
        choice,
      ),
    )
    .filter((bookmark): bookmark is Bookmark => Boolean(bookmark))
    .map((bookmark) => ({
      ...bookmark,
      groupId: normalizedGroups.remappedIds.get(bookmark.groupId) ?? bookmark.groupId,
    }))

  const restoredGroupIds = new Map<string, string>()
  const resolvableBookmarks = mergedBookmarks
    .map((bookmark): Bookmark | undefined => {
      const restoredGroupId = restoredGroupIds.get(bookmark.groupId)
      if (restoredGroupId) return { ...bookmark, groupId: restoredGroupId }
      if (groupIds.has(bookmark.groupId)) return bookmark

      conflicts.push(`收藏“${bookmark.title}”引用了已被另一端删除的分组。`)
      if (!choice) return undefined

      // 用户选择保留某侧收藏时，父分组必须跟随同一侧恢复，否则收藏仍会被过滤。
      const selectedGroups = choice === 'remote' ? remoteGroups : localGroups
      const selectedGroup = selectedGroups.get(bookmark.groupId)
      if (!selectedGroup) return undefined

      const existingGroup = normalizedGroups.groups.find(
        (group) => group.name.toLocaleLowerCase() === selectedGroup.name.toLocaleLowerCase(),
      )
      const targetGroup = existingGroup ?? clone(selectedGroup)
      if (!existingGroup) normalizedGroups.groups.push(targetGroup)
      groupIds.add(targetGroup.id)
      restoredGroupIds.set(bookmark.groupId, targetGroup.id)
      return { ...bookmark, groupId: targetGroup.id }
    })
    .filter((bookmark): bookmark is Bookmark => Boolean(bookmark))
  const bookmarks = collapseDuplicateBookmarks(
    resolvableBookmarks,
    localBookmarks,
    remoteBookmarks,
    conflicts,
    choice,
  )

  return {
    snapshot: {
      meta: { schemaVersion: 1, groups: normalizedGroups.groups },
      bookmarks,
    },
    conflicts,
  }
}

/** 对首次绑定时没有共同基线的两份快照执行保守并集。 */
export function mergeInitialSnapshots(
  local: CollectionSnapshot,
  remote: CollectionSnapshot,
): CollectionSnapshot {
  const groups = clone(local.meta.groups)
  const groupsByName = new Map(groups.map((group) => [group.name.toLocaleLowerCase(), group]))
  const remoteGroupIds = new Map<string, string>()

  for (const remoteGroup of remote.meta.groups) {
    const current = groupsByName.get(remoteGroup.name.toLocaleLowerCase())
    if (current) {
      remoteGroupIds.set(remoteGroup.id, current.id)
      continue
    }
    const group = { ...clone(remoteGroup), id: crypto.randomUUID() }
    groups.push(group)
    groupsByName.set(group.name.toLocaleLowerCase(), group)
    remoteGroupIds.set(remoteGroup.id, group.id)
  }

  const bookmarks = clone(local.bookmarks)
  const urlsByGroup = new Map<string, Set<string>>()
  bookmarks.forEach((bookmark) => {
    const urls = urlsByGroup.get(bookmark.groupId) ?? new Set<string>()
    urls.add(normalizeUrl(bookmark.url))
    urlsByGroup.set(bookmark.groupId, urls)
  })

  for (const remoteBookmark of remote.bookmarks) {
    const groupId = remoteGroupIds.get(remoteBookmark.groupId)
    if (!groupId) continue
    const urls = urlsByGroup.get(groupId) ?? new Set<string>()
    if (urls.has(normalizeUrl(remoteBookmark.url))) continue
    bookmarks.push({ ...clone(remoteBookmark), id: crypto.randomUUID(), groupId })
    urls.add(normalizeUrl(remoteBookmark.url))
    urlsByGroup.set(groupId, urls)
  }

  return { meta: { schemaVersion: 1, groups }, bookmarks }
}

/** 忽略数组顺序比较完整快照，避免无关排序触发重复同步。 */
export function sameSnapshot(left: CollectionSnapshot, right: CollectionSnapshot): boolean {
  const sortById = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify({ meta: { groups: sortById(left.meta.groups) }, bookmarks: sortById(left.bookmarks) }) ===
    JSON.stringify({ meta: { groups: sortById(right.meta.groups) }, bookmarks: sortById(right.bookmarks) })
}
