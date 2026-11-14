import { MAX_TAG_NAME_LENGTH } from '../types'
import {
  MAX_SITE_RULES,
  MAX_SITE_SELECTOR_LENGTH,
  type ExtractConfig,
  type SiteBookmarkSettings,
  type SiteRule,
  type TitleExtractSource,
  type UrlExtractSource,
} from './types'

export const DEFAULT_SITE_BOOKMARK_SETTINGS: SiteBookmarkSettings = { enabled: false, rules: [] }

const URL_SOURCE_KINDS: readonly UrlExtractSource['kind'][] = ['pageUrl', 'closestLink', 'text', 'attribute']
const TITLE_SOURCE_KINDS: readonly TitleExtractSource['kind'][] = ['pageTitle', 'text', 'attribute']

/** 从域名或 HTTP(S) 网址提取主机名，保留明确输入的子域名。 */
export function normalizeSiteDomain(value: string): string | undefined {
  const input = value.trim()
  if (!input || /\s/.test(input)) return undefined
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    const domain = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!domain || domain.includes('..') || domain.startsWith('.')) return undefined
    if (!/^[a-z\d.-]+$/i.test(domain) && !/^\[[0-9a-f:]+\]$/i.test(domain)) return undefined
    return domain
  } catch {
    return undefined
  }
}

/** 精确匹配域名或它的子域名，避免匹配 example.com.evil.test。 */
export function matchesSite(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain) || domain.startsWith('[')) return host === domain
  return host === domain || host.endsWith(`.${domain}`)
}

/** 可选权限和脚本匹配范围共用相同的 HTTP(S) 模式；IP 地址只匹配自身。 */
export function siteOrigins(domain: string): string[] {
  const host = /^\d+\.\d+\.\d+\.\d+$/.test(domain) || domain.startsWith('[') ? domain : `*.${domain}`
  return [`http://${host}/*`, `https://${host}/*`]
}

/** 规则标签名默认取主域名的第一段（IP 地址使用完整主机）。 */
export function defaultTagName(domain: string): string {
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(domain) || domain.startsWith('[')
  return (isIp ? domain : domain.split('.')[0]).slice(0, MAX_TAG_NAME_LENGTH)
}

function normalizeSelector(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const selector = value.trim()
  return selector && selector.length <= MAX_SITE_SELECTOR_LENGTH ? selector : undefined
}

function normalizeExtractConfig<S extends UrlExtractSource | TitleExtractSource>(
  value: unknown,
  allowed: readonly S['kind'][],
): ExtractConfig<S> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { source?: { kind?: unknown; selector?: unknown; attribute?: unknown }; pattern?: unknown }
  const source = candidate.source
  if (!source || typeof source !== 'object' || typeof source.kind !== 'string' || !allowed.includes(source.kind as S['kind'])) return undefined
  if (source.kind === 'text' || source.kind === 'attribute') {
    const selector = normalizeSelector(source.selector)
    if (!selector) return undefined
    if (source.kind === 'text') {
      const pattern = withPattern(candidate.pattern)
      return pattern ? { source: { kind: 'text', selector } as S, ...pattern } : undefined
    }
    const attribute = typeof source.attribute === 'string' ? source.attribute.trim() : ''
    if (!attribute) return undefined
    const pattern = withPattern(candidate.pattern)
    return pattern ? { source: { kind: 'attribute', selector, attribute } as S, ...pattern } : undefined
  }
  const pattern = withPattern(candidate.pattern)
  return pattern ? { source: { kind: source.kind } as S, ...pattern } : undefined
}

/** 空值表示没有正则；undefined 表示正则无效，应丢弃整条配置。 */
function withPattern(value: unknown): { pattern?: string } | undefined {
  if (typeof value !== 'string') return {}
  const pattern = value.trim()
  if (!pattern) return {}
  try { new RegExp(pattern) } catch { return undefined }
  return { pattern }
}

/** 读取本地配置时丢弃无效或超限的规则，保持存储内容可安全执行。 */
export function normalizeSiteBookmarkSettings(value: unknown): SiteBookmarkSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SITE_BOOKMARK_SETTINGS
  const candidate = value as Partial<SiteBookmarkSettings>
  const rules: SiteRule[] = []
  for (const item of Array.isArray(candidate.rules) ? candidate.rules : []) {
    if (rules.length >= MAX_SITE_RULES) break
    if (!item || typeof item !== 'object') continue
    const rule = item as Partial<SiteRule>
    if (typeof rule.id !== 'string' || !rule.id.trim()) continue
    const domain = typeof rule.domain === 'string' ? normalizeSiteDomain(rule.domain) : undefined
    const triggerSelector = normalizeSelector(rule.triggerSelector)
    if (!domain || !triggerSelector) continue
    const containerSelector = normalizeSelector(rule.containerSelector)
    const url = normalizeExtractConfig<UrlExtractSource>(rule.url, URL_SOURCE_KINDS)
    const title = normalizeExtractConfig<TitleExtractSource>(rule.title, TITLE_SOURCE_KINDS)
    if (!url || !title) continue
    const tagName = (typeof rule.tagName === 'string' && rule.tagName.trim() ? rule.tagName : defaultTagName(domain)).trim().slice(0, MAX_TAG_NAME_LENGTH)
    const now = Date.now()
    rules.push({
      id: rule.id,
      domain,
      name: typeof rule.name === 'string' && rule.name.trim() ? rule.name.trim() : domain,
      enabled: rule.enabled !== false,
      triggerSelector,
      ...(containerSelector ? { containerSelector } : {}),
      url,
      title,
      tagName,
      createdAt: typeof rule.createdAt === 'number' ? rule.createdAt : now,
      updatedAt: typeof rule.updatedAt === 'number' ? rule.updatedAt : now,
    })
  }
  return { enabled: candidate.enabled === true, rules }
}

const cssEscape = (value: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/([^\w-])/g, '\\$1'))
const escapeAttr = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** 描述单个元素：优先稳定的 id 和 data-testid，否则用标签加位置。 */
function describeElement(node: Element, positional: boolean): string {
  const tag = node.tagName.toLowerCase()
  if (!positional) {
    if (node.id) return `#${cssEscape(node.id)}`
    const testid = node.getAttribute('data-testid')
    if (testid) return `${tag}[data-testid="${escapeAttr(testid)}"]`
  }
  let index = 1
  for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.tagName === node.tagName) index += 1
  }
  return `${tag}:nth-of-type(${index})`
}

/**
 * 为目标元素生成 CSS 选择器，向上累积层级直到文档内唯一或达到层数上限。
 * 唯一性是精确性启发式：命中的多个同款按钮都属于同一规则的预期行为。
 */
export function buildSelector(target: Element, maxDepth = 4): string {
  const parts: string[] = []
  let node: Element | null = target
  while (node && parts.length < maxDepth && node !== document.documentElement) {
    let segment = describeElement(node, false)
    if (node.id && document.querySelectorAll(segment).length !== 1) segment = describeElement(node, true)
    parts.unshift(segment)
    const selector = parts.join(' > ')
    if (document.querySelectorAll(selector).length === 1) return selector
    node = node.parentElement
  }
  return parts.join(' > ')
}
