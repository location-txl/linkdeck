import { UserFacingError } from '../lib/bookmark-utils'
import { MAX_BOOKMARK_TITLE_LENGTH, MAX_URL_LENGTH, STORAGE_KEYS, type AutoCloseSettings, type AutoCloseHistoryEntry } from '../types'

/** 自动关闭闲置标签页允许的最短和最长闲置时长。 */
export const AUTO_CLOSE_MIN_IDLE_MINUTES = 1
export const AUTO_CLOSE_MAX_IDLE_MINUTES = 10_080
export const AUTO_CLOSE_DEFAULT_IDLE_MINUTES = 120

/** 自动关闭功能的默认配置。 */
export const DEFAULT_AUTO_CLOSE_SETTINGS: AutoCloseSettings = {
  enabled: false,
  idleMinutes: AUTO_CLOSE_DEFAULT_IDLE_MINUTES,
  whitelistDomains: [],
}

/** Service Worker 用来周期检查闲置标签页的闹钟名称。 */
export const AUTO_CLOSE_ALARM_NAME = 'linkdeck:auto-close:check'

/** 闹钟两次触发之间的最大允许间隔，超过后重新开始计时。 */
export const AUTO_CLOSE_MAX_CHECK_GAP_MS = 5 * 60 * 1000

/** 关闭历史最多保留的条目数，超过后丢弃最旧记录。 */
export const AUTO_CLOSE_HISTORY_LIMIT = 2_000

const HTTP_URL_PATTERN = /^https?:\/\//i

type StoredHistoryEntry = {
  url?: unknown
  title?: unknown
  closedAt?: unknown
}

type StoredSessionState = {
  lastCheckAt?: unknown
  idleSince?: unknown
}

/** Service Worker 休眠期间仍需保留的闲置起点。 */
export type AutoCloseSessionState = {
  lastCheckAt?: number
  idleSince: Record<string, number>
}

/** 当测试或旧版浏览器没有 session storage 时的进程内兜底状态。 */
let fallbackSessionState: AutoCloseSessionState = { idleSince: {} }

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function hasChromeSessionStorage(): boolean {
  return hasChromeStorage() && Boolean(chrome.storage?.session)
}

function normalizeStoredDomain(value: unknown): string | undefined {
  return typeof value === 'string' ? normalizeWhitelistDomain(value) : undefined
}

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(normalizeStoredDomain).filter((domain): domain is string => Boolean(domain)))]
}

function parseStoredJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
 * 将用户输入的网址或域名提取为可比较的主机名。
 *
 * @param value 白名单输入，可以是域名或带路径的 HTTP(S) 网址。
 * @returns 小写且去掉末尾句点的域名；输入无效时返回 undefined。
 */
export function normalizeWhitelistDomain(value: string): string | undefined {
  const input = value.trim()
  if (!input) return undefined
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, '')
    if (!hostname || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) return undefined
    if (!/^[a-z\d.-]+$/i.test(hostname) && !/^\[[0-9a-f:]+\]$/i.test(hostname)) return undefined
    return hostname
  } catch {
    return undefined
  }
}

/** 判断标签页主机名是否命中某条域名白名单或其子域名。 */
export function isWhitelistedHost(hostname: string | undefined, domains: string[]): boolean {
  if (!hostname) return false
  const normalizedHost = hostname.toLocaleLowerCase().replace(/\.$/, '')
  return domains.some((domain) => {
    const normalizedDomain = domain.toLocaleLowerCase().replace(/\.$/, '')
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
  })
}

/** 将存储中的任意值恢复为可安全使用的自动关闭配置。 */
export function normalizeAutoCloseSettings(value: unknown): AutoCloseSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AUTO_CLOSE_SETTINGS }
  const candidate = value as Partial<AutoCloseSettings>
  const idleMinutes = typeof candidate.idleMinutes === 'number' && Number.isInteger(candidate.idleMinutes) &&
    candidate.idleMinutes >= AUTO_CLOSE_MIN_IDLE_MINUTES && candidate.idleMinutes <= AUTO_CLOSE_MAX_IDLE_MINUTES
    ? candidate.idleMinutes
    : AUTO_CLOSE_DEFAULT_IDLE_MINUTES
  return {
    enabled: candidate.enabled === true,
    idleMinutes,
    whitelistDomains: normalizeDomains(candidate.whitelistDomains),
  }
}

/** 校验设置面板提交的数据，并返回去重后的本地配置。 */
export function validateAutoCloseSettings(value: AutoCloseSettings): AutoCloseSettings {
  if (!Number.isInteger(value.idleMinutes) || value.idleMinutes < AUTO_CLOSE_MIN_IDLE_MINUTES || value.idleMinutes > AUTO_CLOSE_MAX_IDLE_MINUTES) {
    throw new UserFacingError(`闲置时间需为 ${AUTO_CLOSE_MIN_IDLE_MINUTES}～${AUTO_CLOSE_MAX_IDLE_MINUTES} 的整数分钟。`)
  }
  const whitelistDomains = value.whitelistDomains.map((domain) => normalizeWhitelistDomain(domain))
  if (whitelistDomains.some((domain) => !domain)) throw new UserFacingError('白名单必须是有效的域名或网址。')
  return {
    enabled: value.enabled,
    idleMinutes: value.idleMinutes,
    whitelistDomains: [...new Set(whitelistDomains.filter((domain): domain is string => Boolean(domain)))],
  }
}

/** 读取当前浏览器的自动关闭配置，不参与收藏同步。 */
export async function getAutoCloseSettings(): Promise<AutoCloseSettings> {
  if (hasChromeStorage()) {
    const values = await chrome.storage.local.get(STORAGE_KEYS.autoCloseSettings)
    return normalizeAutoCloseSettings(values[STORAGE_KEYS.autoCloseSettings])
  }
  return normalizeAutoCloseSettings(parseStoredJson(window.localStorage.getItem(STORAGE_KEYS.autoCloseSettings)))
}

/** 保存当前浏览器的自动关闭配置。存储失败时将错误交给设置面板展示。 */
export async function setAutoCloseSettings(value: AutoCloseSettings): Promise<void> {
  const settings = validateAutoCloseSettings(value)
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.autoCloseSettings]: settings })
    return
  }
  window.localStorage.setItem(STORAGE_KEYS.autoCloseSettings, JSON.stringify(settings))
}

function normalizeSessionState(value: unknown): AutoCloseSessionState {
  if (!value || typeof value !== 'object') return { idleSince: {} }
  const candidate = value as StoredSessionState
  const idleSince = candidate.idleSince && typeof candidate.idleSince === 'object'
    ? Object.entries(candidate.idleSince as Record<string, unknown>).reduce<Record<string, number>>((result, [tabId, timestamp]) => {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) result[tabId] = timestamp
      return result
    }, {})
    : {}
  return {
    lastCheckAt: typeof candidate.lastCheckAt === 'number' && Number.isFinite(candidate.lastCheckAt) ? candidate.lastCheckAt : undefined,
    idleSince,
  }
}

/** 读取 Service Worker 使用的会话态，浏览器重启后该状态会自然清空。 */
export async function getAutoCloseSession(): Promise<AutoCloseSessionState> {
  if (hasChromeSessionStorage()) {
    const values = await chrome.storage.session.get(STORAGE_KEYS.autoCloseSession)
    return normalizeSessionState(values[STORAGE_KEYS.autoCloseSession])
  }
  if (hasChromeStorage()) return { ...fallbackSessionState, idleSince: { ...fallbackSessionState.idleSince } }
  return normalizeSessionState(parseStoredJson(window.sessionStorage.getItem(STORAGE_KEYS.autoCloseSession)))
}

/** 保存闲置计时会话态，不写入同步存储。 */
export async function setAutoCloseSession(value: AutoCloseSessionState): Promise<void> {
  const state = normalizeSessionState(value)
  if (hasChromeSessionStorage()) {
    await chrome.storage.session.set({ [STORAGE_KEYS.autoCloseSession]: state })
    return
  }
  if (hasChromeStorage()) {
    fallbackSessionState = state
    return
  }
  window.sessionStorage.setItem(STORAGE_KEYS.autoCloseSession, JSON.stringify(state))
}

/** 清除闲置计时，供停用功能和浏览器启动时重新开始计时。 */
export async function clearAutoCloseSession(): Promise<void> {
  if (hasChromeSessionStorage()) {
    await chrome.storage.session.remove(STORAGE_KEYS.autoCloseSession)
    return
  }
  if (hasChromeStorage()) {
    fallbackSessionState = { idleSince: {} }
    return
  }
  window.sessionStorage.removeItem(STORAGE_KEYS.autoCloseSession)
}

function normalizeHistoryEntry(value: unknown): AutoCloseHistoryEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as StoredHistoryEntry
  if (typeof candidate.url !== 'string' || !HTTP_URL_PATTERN.test(candidate.url) || candidate.url.length > MAX_URL_LENGTH) return undefined
  if (typeof candidate.closedAt !== 'number' || !Number.isFinite(candidate.closedAt) || candidate.closedAt <= 0) return undefined
  const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH) : ''
  return { url: candidate.url, title, closedAt: candidate.closedAt }
}

/** 将存储中的任意值恢复为按新到旧排序的关闭历史，非法条目会被丢弃。 */
export function normalizeAutoCloseHistory(value: unknown): AutoCloseHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeHistoryEntry)
    .filter((entry): entry is AutoCloseHistoryEntry => Boolean(entry))
    .slice(0, AUTO_CLOSE_HISTORY_LIMIT)
}

/** 读取本浏览器的自动关闭历史，浏览器重启后仍保留。 */
export async function getAutoCloseHistory(): Promise<AutoCloseHistoryEntry[]> {
  if (hasChromeStorage()) {
    const values = await chrome.storage.local.get(STORAGE_KEYS.autoCloseHistory)
    return normalizeAutoCloseHistory(values[STORAGE_KEYS.autoCloseHistory])
  }
  return normalizeAutoCloseHistory(parseStoredJson(window.localStorage.getItem(STORAGE_KEYS.autoCloseHistory)))
}

/** 记录一条自动关闭历史，新条目排在最前并裁剪到保留上限。 */
export async function appendAutoCloseHistory(entry: AutoCloseHistoryEntry): Promise<void> {
  const normalized = normalizeHistoryEntry(entry)
  if (!normalized) return
  const history = [normalized, ...(await getAutoCloseHistory())].slice(0, AUTO_CLOSE_HISTORY_LIMIT)
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.autoCloseHistory]: history })
    return
  }
  window.localStorage.setItem(STORAGE_KEYS.autoCloseHistory, JSON.stringify(history))
}

/** 清空全部自动关闭历史，仅供用户在界面上手动触发。 */
export async function clearAutoCloseHistory(): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.remove(STORAGE_KEYS.autoCloseHistory)
    return
  }
  window.localStorage.removeItem(STORAGE_KEYS.autoCloseHistory)
}
