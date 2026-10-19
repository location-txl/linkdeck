import { STORAGE_KEYS, type SameTabSettings } from './types'
import { normalizeSameTabSettings } from './rules'
import { SAME_TAB_REFRESH, type SameTabResponse } from './messages'

/** 读取当前浏览器的导航配置。 */
export async function getSameTabSettings(): Promise<SameTabSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const saved = await chrome.storage.local.get(STORAGE_KEYS.sameTabSettings)
    return normalizeSameTabSettings(saved[STORAGE_KEYS.sameTabSettings])
  }
  try {
    return normalizeSameTabSettings(JSON.parse(localStorage.getItem(STORAGE_KEYS.sameTabSettings) ?? 'null'))
  } catch {
    return normalizeSameTabSettings(undefined)
  }
}

/** 保存配置并等待后台应用；失败时恢复原配置，避免表单显示未生效的值。 */
export async function setSameTabSettings(settings: SameTabSettings): Promise<void> {
  const next = normalizeSameTabSettings(settings)
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    localStorage.setItem(STORAGE_KEYS.sameTabSettings, JSON.stringify(next))
    return
  }
  const previous = await getSameTabSettings()
  await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: next })
  try {
    const response = await chrome.runtime.sendMessage({ type: SAME_TAB_REFRESH }) as SameTabResponse
    if (!response?.ok) throw new Error(response?.error ?? '应用导航设置失败，请重试。')
  } catch (error) {
    await chrome.storage.local.set({ [STORAGE_KEYS.sameTabSettings]: previous })
    await chrome.runtime.sendMessage({ type: SAME_TAB_REFRESH }).catch(() => undefined)
    throw error
  }
}
