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
  // 规范化会丢弃无效或超限的规则；直接拒绝写入，避免"保存成功但规则悄悄消失"。
  const keptIds = new Set(next.rules.map((rule) => rule.id))
  if (settings.rules.some((rule) => !keptIds.has(rule.id))) {
    throw new Error('规则内容无效或选择器超过长度限制，未保存。')
  }
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    localStorage.setItem(SITE_BOOKMARK_KEY, JSON.stringify(next))
    return
  }
  await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: next })
}
