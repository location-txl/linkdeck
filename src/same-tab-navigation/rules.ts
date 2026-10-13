import type { SameTabRule, SameTabSettings } from '../types'

/** 缺失或无效配置不会改变网站的导航行为。 */
export const DEFAULT_SAME_TAB_SETTINGS: SameTabSettings = { enabled: false, sites: [] }

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

/** 读取本地配置时去重并丢弃无效规则。 */
export function normalizeSameTabSettings(value: unknown): SameTabSettings {
  if (!value || typeof value !== 'object') return { enabled: false, sites: [] }
  const candidate = value as Partial<SameTabSettings>
  const sites: SameTabRule[] = []
  for (const item of Array.isArray(candidate.sites) ? candidate.sites : []) {
    if (!item || typeof item !== 'object' || typeof item.domain !== 'string') continue
    const domain = normalizeSiteDomain(item.domain)
    if (!domain || sites.some((site) => site.domain === domain)) continue
    if (item.scope !== 'site' && item.scope !== 'all') continue
    sites.push({ domain, scope: item.scope })
  }
  return { enabled: candidate.enabled === true, sites }
}

/** 重叠规则优先使用更具体的来源域名。 */
export function findSiteRule(settings: SameTabSettings, hostname: string): SameTabRule | null {
  if (!settings.enabled) return null
  return settings.sites.reduce<SameTabRule | null>((best, site) =>
    matchesSite(hostname, site.domain) && (!best || site.domain.length > best.domain.length) ? site : best, null)
}

/** 可选权限和脚本匹配范围共用相同的 HTTP(S) 模式。IP 地址只匹配自身。 */
export function siteOrigins(domain: string): string[] {
  const host = /^\d+\.\d+\.\d+\.\d+$/.test(domain) || domain.startsWith('[') ? domain : `*.${domain}`
  return [`http://${host}/*`, `https://${host}/*`]
}

/** 判断目标是否属于规则允许的普通网页导航。 */
export function allowsNavigation(rule: SameTabRule | null, href: string, baseUrl: string): boolean {
  if (!rule) return false
  try {
    const target = new URL(href, baseUrl)
    return ['http:', 'https:'].includes(target.protocol) && (rule.scope === 'all' || matchesSite(target.hostname, rule.domain))
  } catch {
    return false
  }
}
