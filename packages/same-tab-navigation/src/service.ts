import type { SameTabRule } from './types'
import { getSameTabSettings } from './preferences'
import { findSiteRule, matchesSite, siteOrigins } from './rules'
import { SAME_TAB_GET_RULE, SAME_TAB_REFRESH, SAME_TAB_UPDATE, type SameTabResponse } from './messages'

// Chrome 会保留已注册脚本的源码缓存；升级脚本时更换 ID 并移除旧注册。
const SCRIPT_ID_PREFIX = 'linkdeck-same-tab-'
const MAIN_SCRIPT_ID = `${SCRIPT_ID_PREFIX}main-v3`
const BRIDGE_SCRIPT_ID = `${SCRIPT_ID_PREFIX}bridge-v3`
const MAIN_FILE = 'assets/same-tab-main.js'
const BRIDGE_FILE = 'assets/same-tab-content.js'
let pending: Promise<void> = Promise.resolve()

/** 只根据 Chrome 提供的来源网址返回规则，并确认该来源仍有网站权限。 */
export async function getEffectiveSiteRule(sourceUrl: string): Promise<SameTabRule | null> {
  let url: URL
  try { url = new URL(sourceUrl) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const rule = findSiteRule(await getSameTabSettings(), url.hostname)
  if (!rule || !await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) return null
  return rule
}

async function reconcileScripts(): Promise<void> {
  const settings = await getSameTabSettings()
  const registered = (await chrome.scripting.getRegisteredContentScripts()).filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
  const origins = settings.enabled ? (await Promise.all(settings.sites.flatMap((site) =>
    siteOrigins(site.domain).map(async (origin) => await chrome.permissions.contains({ origins: [origin] }) ? origin : null))))
    .filter((origin): origin is string => origin !== null) : []
  const matches = [...new Set(origins)].sort()
  const currentMatches = [...(registered[0]?.matches ?? [])].sort()
  const registrationChanged = registered.length !== (matches.length ? 2 : 0) ||
    registered.some((script) => script.id !== MAIN_SCRIPT_ID && script.id !== BRIDGE_SCRIPT_ID) ||
    JSON.stringify(currentMatches) !== JSON.stringify(matches)

  if (registrationChanged) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) })
    if (matches.length) {
      await chrome.scripting.registerContentScripts([
        { id: MAIN_SCRIPT_ID, js: [MAIN_FILE], matches, runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
        { id: BRIDGE_SCRIPT_ID, js: [BRIDGE_FILE], matches, runAt: 'document_start', world: 'ISOLATED', persistAcrossSessions: true },
      ])
    }
  }

  if (!registered.length && !settings.sites.length) return
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) return
    // 已注入的脚本不会随 unregister 消失，因此同时通知现有页面停止旧规则。
    await chrome.tabs.sendMessage(tab.id, { type: SAME_TAB_UPDATE }).catch(() => undefined)
    if (!settings.enabled || !settings.sites.some((site) => matchesSite(new URL(tab.url!).hostname, site.domain))) return
    if (!await getEffectiveSiteRule(tab.url)) return
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [MAIN_FILE], world: 'MAIN', injectImmediately: true })
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [BRIDGE_FILE], world: 'ISOLATED', injectImmediately: true })
    } catch {
      // 标签页可能已经导航、关闭，或被浏览器设为禁止注入；下次加载仍由动态注册生效。
    }
  }))
}

/** 串行应用最新配置，避免连续保存和授权事件交错注册脚本。 */
export function syncSameTabNavigation(): Promise<void> {
  pending = pending.catch(() => undefined).then(reconcileScripts)
  return pending
}

/** 在后台顶层注册权限变化监听；撤销授权后通知已打开页面停用旧规则。 */
export function registerSameTabNavigationService(): void {
  const refresh = () => { void syncSameTabNavigation().catch((error: unknown) => console.warn('更新当前标签页导航失败', error)) }
  chrome.permissions.onAdded.addListener(refresh)
  chrome.permissions.onRemoved.addListener(refresh)
  refresh()
}

/** 处理设置页应用请求和内容脚本的规则读取请求。 */
export async function handleSameTabMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<SameTabResponse> {
  try {
    const type = (message as { type?: unknown }).type
    if (type === SAME_TAB_GET_RULE) {
      if (!sender.tab || sender.frameId !== 0 || !sender.url) return { ok: true, rule: null }
      return { ok: true, rule: await getEffectiveSiteRule(sender.url) }
    }
    if (type === SAME_TAB_REFRESH && (!sender.tab || sender.url?.startsWith(chrome.runtime.getURL('')))) {
      await syncSameTabNavigation()
      return { ok: true }
    }
    return { ok: false, error: '无效的导航设置请求。' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '应用导航设置失败，请重试。' }
  }
}

/** 识别本功能消息，不接收网页提供的任意目标网址。 */
export function isSameTabMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('type' in message)) return false
  return message.type === SAME_TAB_GET_RULE || message.type === SAME_TAB_REFRESH
}
