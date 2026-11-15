import { MAX_BOOKMARK_TITLE_LENGTH } from '@linkdeck/shared'
import { bookmarkRepository } from '../bookmark-repository'
import { SITE_BOOKMARK_SAVE, SITE_BOOKMARK_STOP, type SiteBookmarkResponse } from './messages'
import { getSiteBookmarkSettings } from './preferences'
import { matchesSite, siteOrigins } from './rules'
import { SITE_BOOKMARK_KEY, type SiteBookmarkSettings } from './types'

// Chrome 会保留已注册脚本的源码缓存；升级脚本时更换 ID 并移除旧注册。
const SCRIPT_ID_PREFIX = 'linkdeck-site-bookmark-'
const SCRIPT_ID = `${SCRIPT_ID_PREFIX}v1`
const CONTENT_FILE = 'assets/site-bookmark-content.js'
let pending: Promise<void> = Promise.resolve()

/** 启用规则覆盖域名中已授权的 HTTP(S) 模式，作为脚本注册范围。 */
async function grantedOrigins(settings: SiteBookmarkSettings): Promise<string[]> {
  if (!settings.enabled) return []
  const domains = [...new Set(settings.rules.filter((rule) => rule.enabled).map((rule) => rule.domain))]
  const origins = await Promise.all(domains.flatMap((domain) => siteOrigins(domain).map(async (origin) =>
    await chrome.permissions.contains({ origins: [origin] }) ? origin : null)))
  return [...new Set(origins.filter((origin): origin is string => origin !== null))].sort()
}

/** 该来源页面是否仍有生效规则和网站授权，决定补注入或通知清理。 */
async function pageNeedsInjection(settings: SiteBookmarkSettings, pageUrl: string): Promise<boolean> {
  if (!settings.enabled) return false
  let url: URL
  try { url = new URL(pageUrl) } catch { return false }
  if (!['http:', 'https:'].includes(url.protocol)) return false
  if (!settings.rules.some((rule) => rule.enabled && matchesSite(url.hostname, rule.domain))) return false
  return await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })
}

/** 规则或授权变化时同步脚本注册；已打开页面按需补注入或停止旧规则。 */
export function syncSiteBookmarkScripts(): Promise<void> {
  pending = pending.catch(() => undefined).then(async () => {
    const settings = await getSiteBookmarkSettings()
    const matches = await grantedOrigins(settings)
    const registered = (await chrome.scripting.getRegisteredContentScripts()).filter(({ id }) => id.startsWith(SCRIPT_ID_PREFIX))
    const currentMatches = [...(registered[0]?.matches ?? [])].sort()
    const registrationChanged = registered.length !== (matches.length ? 1 : 0) ||
      registered.some(({ id }) => id !== SCRIPT_ID) ||
      JSON.stringify(currentMatches) !== JSON.stringify(matches)
    if (registrationChanged) {
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(({ id }) => id) })
      if (matches.length) {
        await chrome.scripting.registerContentScripts([{
          id: SCRIPT_ID, matches, js: [CONTENT_FILE],
          runAt: 'document_idle', world: 'ISOLATED', persistAcrossSessions: true,
        }])
      }
    }
    const tabs = await chrome.tabs.query({})
    await Promise.all(tabs.map(async (tab) => {
      if (tab.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) return
      // 注销不会移除已注入的脚本；现有页面按当前规则补注入或主动清理监听器。
      if (await pageNeedsInjection(settings, tab.url)) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_FILE] }).catch(() => undefined)
      } else {
        await chrome.tabs.sendMessage(tab.id, { type: SITE_BOOKMARK_STOP }).catch(() => undefined)
      }
    }))
  })
  return pending
}

/** 校验保存请求来源与规则匹配后入库；不信任内容脚本提交的任意字段。 */
export async function handleSiteBookmarkMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<SiteBookmarkResponse> {
  try {
    const type = (message as { type?: unknown })?.type
    if (type !== SITE_BOOKMARK_SAVE) throw new Error('无效的收藏请求。')
    if (!sender.tab || sender.frameId !== 0 || !sender.url) throw new Error('无效的页面来源。')
    let source: URL
    try { source = new URL(sender.url) } catch { throw new Error('无效的页面来源。') }
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error('无效的页面来源。')
    const { ruleId, url: rawUrl, title: rawTitle } = message as { ruleId?: unknown; url?: unknown; title?: unknown }
    if (typeof ruleId !== 'string' || typeof rawUrl !== 'string' || typeof rawTitle !== 'string') throw new Error('无效的收藏内容。')
    const settings = await getSiteBookmarkSettings()
    const rule = settings.enabled
      ? settings.rules.find((item) => item.id === ruleId && item.enabled && matchesSite(source.hostname, item.domain))
      : undefined
    if (!rule) throw new Error('这条收藏规则已停用，请在 LinkDeck 设置中检查。')
    if (!await chrome.permissions.contains({ origins: [`${source.protocol}//${source.hostname}/*`] })) {
      throw new Error('该网站的授权已撤销，请在 LinkDeck 设置中重新授权。')
    }
    let url: URL
    try { url = new URL(rawUrl, sender.url) } catch { throw new Error('无法识别这个链接。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('无法识别这个链接。')
    const result = await bookmarkRepository.createBookmark({
      url: url.href,
      title: rawTitle.trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH),
      tagIds: [],
      newTagNames: [rule.tagName],
    })
    return { ok: true, created: result.created, tagsMerged: result.tagsMerged }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '收藏失败，请重试。' }
  }
}

/** 注册站点收藏后台：保存消息处理与规则/授权变化的脚本同步。 */
export function registerSiteBookmarkBackground(): void {
  const refresh = () => { void syncSiteBookmarkScripts().catch((error: unknown) => console.warn('更新站点收藏脚本失败', error)) }
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== SITE_BOOKMARK_SAVE) return undefined
    void handleSiteBookmarkMessage(message, sender).then(sendResponse)
    return true
  })
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[SITE_BOOKMARK_KEY]) refresh() })
  chrome.permissions.onAdded.addListener(refresh)
  chrome.permissions.onRemoved.addListener(refresh)
  chrome.runtime.onInstalled.addListener(refresh)
  chrome.runtime.onStartup.addListener(refresh)
  refresh()
}
