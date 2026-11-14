import { MAX_BOOKMARK_TITLE_LENGTH } from '@linkdeck/shared'
import { createNotice } from '../content-notice'
import { SITE_BOOKMARK_SAVE, SITE_BOOKMARK_STOP, type SiteBookmarkResponse } from './messages'
import { getSiteBookmarkSettings } from './preferences'
import { matchesSite } from './rules'
import { SITE_BOOKMARK_KEY, type ExtractConfig, type SiteRule, type TitleExtractSource, type UrlExtractSource } from './types'

/** 过滤出对当前主机生效的启用规则。 */
export function activeRulesFor(rules: SiteRule[], hostname: string): SiteRule[] {
  return rules.filter((rule) => rule.enabled && matchesSite(hostname, rule.domain))
}

function safeClosest(element: Element, selector: string): Element | null {
  try { return element.closest(selector) } catch { return null }
}

function safeQuery(scope: Element | Document, selector: string): Element | null {
  try { return scope.querySelector(selector) } catch { return null }
}

/** 按提取配置取原始值，再做可选的正则后处理（不匹配保留原值，无效正则忽略）。 */
export function extractValue<S extends UrlExtractSource | TitleExtractSource>(
  config: ExtractConfig<S>, trigger: Element, container: Element,
): string | undefined {
  const { source } = config
  let raw: string | undefined
  if (source.kind === 'pageUrl') raw = location.href
  else if (source.kind === 'pageTitle') raw = document.title
  else if (source.kind === 'closestLink') raw = (safeClosest(trigger, 'a[href]') ?? safeQuery(container, 'a[href]'))?.getAttribute('href') ?? undefined
  else if (source.kind === 'text') raw = safeQuery(container, source.selector)?.textContent?.trim() ?? undefined
  else raw = safeQuery(container, source.selector)?.getAttribute(source.attribute) ?? undefined
  if (raw === undefined || raw === '') return undefined
  if (!config.pattern) return raw
  try {
    const match = new RegExp(config.pattern).exec(raw)
    return match ? (match[1] ?? match[0]) : raw
  } catch {
    return raw
  }
}

function canonicalUrl(config: ExtractConfig<UrlExtractSource>, trigger: Element, container: Element): string | undefined {
  const raw = extractValue(config, trigger, container)
  if (!raw) return undefined
  try {
    const url = new URL(raw, location.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** 安装点击监听：命中规则的触发按钮即收藏，不干预网页自身的点击行为。 */
export function installSiteBookmark(rules: SiteRule[]): () => void {
  const notice = createNotice()
  const save = async (payload: { ruleId: string; url: string; title: string }, ruleName: string, tagName: string) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: SITE_BOOKMARK_SAVE, ...payload }) as SiteBookmarkResponse | undefined
      if (!response?.ok) throw new Error(response?.error ?? '扩展未响应，请刷新页面后重试。')
      notice.show(response.created ? `已收藏到 LinkDeck · ${ruleName}` : response.tagsMerged ? `已为 LinkDeck 收藏添加「${tagName}」标签` : 'LinkDeck 中已收藏这个链接')
    } catch (error) {
      notice.show(`LinkDeck 收藏失败：${error instanceof Error ? error.message : '请重试。'}`, () => { void save(payload, ruleName, tagName) })
    }
  }
  const onClick = (event: MouseEvent) => {
    // 选取器引导期间跳过：点选元素是配置操作，不应触发已有规则保存。
    if (document.documentElement.dataset.linkdeckPicking !== undefined) return
    if (!(event.target instanceof Element)) return
    for (const rule of rules) {
      const trigger = safeClosest(event.target, rule.triggerSelector)
      if (!trigger) continue
      // 命中规则即结束处理：容器不符或提取失败都给出提示，避免静默丢收藏。
      const container = rule.containerSelector ? safeClosest(trigger, rule.containerSelector) : document.body
      if (!container) {
        notice.show(`LinkDeck 未能定位「${rule.name}」规则的卡片容器，请在设置中调整。`)
        return
      }
      const url = canonicalUrl(rule.url, trigger, container)
      if (!url) {
        notice.show(`LinkDeck 未能从该页面提取链接，请在设置中调整「${rule.name}」规则。`)
        return
      }
      const title = extractValue(rule.title, trigger, container)?.trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH) ?? ''
      void save({ ruleId: rule.id, url, title }, rule.name, rule.tagName)
      return
    }
  }
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    notice.dispose()
  }
}

// 非扩展环境（测试、工具链）加载此模块时跳过安装。
if ((location.protocol === 'https:' || location.protocol === 'http:') && typeof chrome !== 'undefined') {
  const scope = globalThis as typeof globalThis & { linkdeckSiteBookmarkCleanup?: () => void }
  // 后台唤醒会重复注入，保留已初始化的实例和正在保存、重试的状态。
  if (!scope.linkdeckSiteBookmarkCleanup) {
    let cancelled = false
    let uninstall: (() => void) | undefined
    const cleanup = () => {
      cancelled = true
      uninstall?.()
      chrome.storage.onChanged.removeListener(onStorageChanged)
      chrome.runtime.onMessage.removeListener(onMessage)
      if (scope.linkdeckSiteBookmarkCleanup === cleanup) delete scope.linkdeckSiteBookmarkCleanup
    }
    const onMessage = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === SITE_BOOKMARK_STOP) cleanup()
      return undefined
    }
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SITE_BOOKMARK_KEY]) void applyRules()
    }
    const applyRules = async () => {
      if (cancelled) return
      const settings = await getSiteBookmarkSettings()
      uninstall?.()
      uninstall = undefined
      // 总开关关闭时不依赖后台 STOP 消息兜底，页面侧立即停止监听。
      if (!settings.enabled) return
      const active = activeRulesFor(settings.rules, location.hostname)
      if (active.length) uninstall = installSiteBookmark(active)
    }
    scope.linkdeckSiteBookmarkCleanup = cleanup
    chrome.runtime.onMessage.addListener(onMessage)
    chrome.storage.onChanged.addListener(onStorageChanged)
    void applyRules().catch(() => cleanup())
  }
}
