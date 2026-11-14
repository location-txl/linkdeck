import { SITE_BOOKMARK_KEY, type SiteBookmarkSettings } from './types'
import { normalizeSiteBookmarkSettings } from './rules'

/** 读取站点收藏规则；后台和已注入页面都通过 storage.onChanged 跟随变化。 */
export async function getSiteBookmarkSettings(): Promise<SiteBookmarkSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const saved = await chrome.storage.local.get(SITE_BOOKMARK_KEY)
    return normalizeSiteBookmarkSettings(saved[SITE_BOOKMARK_KEY])
  }
  try {
    return normalizeSiteBookmarkSettings(JSON.parse(localStorage.getItem(SITE_BOOKMARK_KEY) ?? 'null'))
  } catch {
    return normalizeSiteBookmarkSettings(undefined)
  }
}

/** 写入规则并规范化；脚本注册由后台监听 storage.onChanged 统一应用。 */
export async function setSiteBookmarkSettings(settings: SiteBookmarkSettings): Promise<void> {
  const next = normalizeSiteBookmarkSettings(settings)
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    localStorage.setItem(SITE_BOOKMARK_KEY, JSON.stringify(next))
    return
  }
  await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: next })
}
