import { STORAGE_KEYS, type TabGroupSettings } from './types'

/** 链接标签组的默认配置。 */
export const DEFAULT_TAB_GROUP_SETTINGS: TabGroupSettings = {
  enabled: false,
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function parseStoredJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** 将存储中的任意值恢复为可安全使用的链接标签组配置。 */
export function normalizeTabGroupSettings(value: unknown): TabGroupSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TAB_GROUP_SETTINGS }
  return { enabled: (value as Partial<TabGroupSettings>).enabled === true }
}

/** 读取链接标签组配置，不参与收藏同步。 */
export async function getTabGroupSettings(): Promise<TabGroupSettings> {
  if (hasChromeStorage()) {
    const values = await chrome.storage.local.get(STORAGE_KEYS.tabGroupSettings)
    return normalizeTabGroupSettings(values[STORAGE_KEYS.tabGroupSettings])
  }
  return normalizeTabGroupSettings(parseStoredJson(window.localStorage.getItem(STORAGE_KEYS.tabGroupSettings)))
}

/** 保存链接标签组配置。存储失败时将错误交给设置面板展示。 */
export async function setTabGroupSettings(value: TabGroupSettings): Promise<void> {
  const settings = normalizeTabGroupSettings(value)
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.tabGroupSettings]: settings })
    return
  }
  window.localStorage.setItem(STORAGE_KEYS.tabGroupSettings, JSON.stringify(settings))
}
