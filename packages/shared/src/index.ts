export const MAX_BOOKMARK_TITLE_LENGTH = 80
export const MAX_URL_LENGTH = 2048

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export function normalizeUrl(input: string): string {
  const candidate = input.trim()

  if (!candidate) throw new UserFacingError('请输入网址。')
  if (candidate.length > MAX_URL_LENGTH) {
    throw new UserFacingError(`网址不能超过 ${MAX_URL_LENGTH} 个字符。`)
  }

  const urlWithProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate)
    ? candidate
    : `https://${candidate}`

  let parsed: URL
  try {
    parsed = new URL(urlWithProtocol)
  } catch {
    throw new UserFacingError('请输入有效的网址。')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UserFacingError('只支持 http 或 https 网址。')
  }

  if (!parsed.hostname) {
    throw new UserFacingError('请输入有效的网址。')
  }
  return parsed.href
}

export function getHostname(url: string): string {
  return new URL(url).hostname
}

export function makeFaviconUrl(url: string): string {
  return `https://a.favicon.im/${encodeURIComponent(getHostname(url))}?throw-error-on-404=true`
}

export function fallbackTitleForUrl(url: string): string {
  return getHostname(url).replace(/^www\./i, '')
}

export function getDomainInitial(url: string): string {
  return fallbackTitleForUrl(url).slice(0, 1).toUpperCase() || '·'
}

export function hasSameUrl(left: string, right: string): boolean {
  return normalizeUrl(left) === normalizeUrl(right)
}

export function storageItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key).byteLength +
    new TextEncoder().encode(JSON.stringify(value)).byteLength
}
