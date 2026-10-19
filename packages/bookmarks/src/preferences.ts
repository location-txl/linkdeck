import { STORAGE_KEYS, type TagClickMode, type TagFilter } from './types'

function hasChromeLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function normalizeFilter(value: unknown): TagFilter | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<TagFilter>
  if (!Array.isArray(candidate.tagIds) || !candidate.tagIds.every((tagId) => typeof tagId === 'string')) {
    return undefined
  }
  if (typeof candidate.untaggedOnly !== 'boolean') return undefined
  return { tagIds: [...new Set(candidate.tagIds)], untaggedOnly: candidate.untaggedOnly }
}

function normalizeTagClickMode(value: unknown): TagClickMode | undefined {
  return value === 'modifier-multi' || value === 'direct-multi' ? value : undefined
}

/** 读取多标签筛选，并将旧版单分组选择迁移为单标签筛选。 */
export async function getTagFilter(): Promise<TagFilter> {
  if (hasChromeLocalStorage()) {
    const values = await chrome.storage.local.get([STORAGE_KEYS.tagFilter, STORAGE_KEYS.legacySelectedGroup])
    const saved = normalizeFilter(values[STORAGE_KEYS.tagFilter])
    if (saved) return saved
    const legacyTagId = values[STORAGE_KEYS.legacySelectedGroup]
    return typeof legacyTagId === 'string' ? { tagIds: [legacyTagId], untaggedOnly: false } : { tagIds: [], untaggedOnly: false }
  }
  const saved = normalizeFilter(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.tagFilter) ?? 'null'))
  if (saved) return saved
  const legacyTagId = window.localStorage.getItem(STORAGE_KEYS.legacySelectedGroup)
  return legacyTagId ? { tagIds: [legacyTagId], untaggedOnly: false } : { tagIds: [], untaggedOnly: false }
}

export async function setTagFilter(filter: TagFilter): Promise<void> {
  const value = { tagIds: [...new Set(filter.tagIds)], untaggedOnly: filter.untaggedOnly }
  if (hasChromeLocalStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.tagFilter]: value })
    return
  }
  window.localStorage.setItem(STORAGE_KEYS.tagFilter, JSON.stringify(value))
}

/** 读取标签点击方式；缺失或无效值使用默认的组合键多选方式。 */
export async function getTagClickMode(): Promise<TagClickMode> {
  if (hasChromeLocalStorage()) {
    const values = await chrome.storage.local.get(STORAGE_KEYS.tagClickMode)
    return normalizeTagClickMode(values[STORAGE_KEYS.tagClickMode]) ?? 'modifier-multi'
  }
  return normalizeTagClickMode(window.localStorage.getItem(STORAGE_KEYS.tagClickMode)) ?? 'modifier-multi'
}

/** 保存当前浏览器配置的标签点击方式，不参与收藏数据同步。 */
export async function setTagClickMode(mode: TagClickMode): Promise<void> {
  if (hasChromeLocalStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.tagClickMode]: mode })
    return
  }
  window.localStorage.setItem(STORAGE_KEYS.tagClickMode, mode)
}
