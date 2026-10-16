import { STORAGE_KEYS } from './types'

/** 只识别收藏同步数据的变更，忽略各功能的本地设置。 */
export function hasLinkDeckStorageChange(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some(
    (key) => key === STORAGE_KEYS.meta || key.startsWith(STORAGE_KEYS.tagPrefix) ||
      key.startsWith(STORAGE_KEYS.bookmarkPrefix),
  )
}
