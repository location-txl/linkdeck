import {
  createBackup,
  parseBackupJson,
  type LinkDeckBackup,
} from '../data-transfer/data-transfer'
import type { CollectionSnapshot } from '../types'
import {
  GIST_SYNC_FILE_NAME,
  type GistCredentials,
  type GistSyncDocument,
  type GistSyncMetadata,
} from './types'

const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_API_VERSION = '2026-03-10'

type GistFile = {
  content?: string
  truncated?: boolean
}

type GistResponse = {
  id?: string
  html_url?: string
  files?: Record<string, GistFile>
}

/** GitHub Gist API 返回的、可展示的远端同步文件。 */
export type RemoteGist = {
  id: string
  url: string
  document: GistSyncDocument
}

/** 适合直接显示给用户的 GitHub API 错误。 */
export class GistApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GistApiError'
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createRevisionId(): string {
  return crypto.randomUUID()
}

function errorForStatus(status: number): GistApiError {
  if (status === 401) return new GistApiError('GitHub 令牌无效或已过期。', status)
  if (status === 403) return new GistApiError('GitHub 拒绝了请求，请确认令牌具有 Gists 写入权限。', status)
  if (status === 404) return new GistApiError('找不到该 Gist，可能已删除或令牌没有访问权限。', status)
  if (status === 429) return new GistApiError('GitHub 请求过于频繁，请稍后自动重试。', status)
  if (status >= 500) return new GistApiError('GitHub 服务暂时不可用，请稍后自动重试。', status)
  return new GistApiError(`GitHub 同步请求失败（HTTP ${status}）。`, status)
}

async function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${GITHUB_API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...init?.headers,
      },
    })
    if (!response.ok) throw errorForStatus(response.status)
    return response
  } catch (error) {
    if (error instanceof GistApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new GistApiError('连接 GitHub 超时，请稍后自动重试。')
    }
    throw new GistApiError('无法连接 GitHub，请检查网络后重试。')
  } finally {
    clearTimeout(timeout)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredSyncMetadata(value: unknown): GistSyncMetadata {
  if (!isRecord(value)) throw new GistApiError('该 Gist 不是 LinkDeck 同步文件。')
  if (
    value.protocolVersion !== 1 ||
    typeof value.revisionId !== 'string' ||
    !value.revisionId ||
    (value.parentRevisionId !== null && typeof value.parentRevisionId !== 'string') ||
    typeof value.writtenAt !== 'string' ||
    Number.isNaN(Date.parse(value.writtenAt))
  ) {
    throw new GistApiError('该 Gist 的同步元数据格式不正确。')
  }

  return {
    protocolVersion: 1,
    revisionId: value.revisionId,
    parentRevisionId: value.parentRevisionId,
    writtenAt: new Date(value.writtenAt).toISOString(),
  }
}

/** 解析 Gist 文件，并复用本地备份的完整格式校验。 */
export function parseGistDocument(text: string): GistSyncDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new GistApiError('Gist 中的同步文件不是有效 JSON。')
  }

  if (!isRecord(raw)) throw new GistApiError('Gist 中的同步文件格式不正确。')
  const backup = parseBackupJson(text)
  return {
    ...backup,
    sync: requiredSyncMetadata(raw.sync),
  }
}

/** 创建保留 LinkDeck 备份格式的 Gist 同步文档。 */
export function createGistDocument(
  snapshot: CollectionSnapshot,
  parentRevisionId: string | null,
  now = new Date(),
): GistSyncDocument {
  const backup: LinkDeckBackup = createBackup(snapshot, now)
  return {
    ...backup,
    sync: {
      protocolVersion: 1,
      revisionId: createRevisionId(),
      parentRevisionId,
      writtenAt: now.toISOString(),
    },
  }
}

export function serializeGistDocument(document: GistSyncDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** 将用户输入的 Gist 链接或 ID 规范化为 API 可用的 ID。 */
export function parseGistId(input: string): string {
  const value = input.trim()
  if (!value) throw new GistApiError('请输入已有 Gist 的链接或 ID。')

  let gistId = value
  try {
    const url = new URL(value)
    if (url.hostname !== 'gist.github.com') throw new Error('unexpected host')
    gistId = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
  } catch {
    // 纯 ID 不需要 URL 解析。
  }

  if (!/^[a-zA-Z0-9]+$/.test(gistId)) {
    throw new GistApiError('Gist 链接或 ID 格式不正确。')
  }
  return gistId
}

function parseGistResponse(value: unknown): GistResponse {
  if (!isRecord(value)) throw new GistApiError('GitHub 返回了无法识别的 Gist 数据。')
  return value as GistResponse
}

function remoteFromResponse(value: unknown): RemoteGist {
  const gist = parseGistResponse(value)
  const id = gist.id
  const url = gist.html_url
  const file = gist.files?.[GIST_SYNC_FILE_NAME]
  if (!id || !url) throw new GistApiError('GitHub 返回的 Gist 缺少标识信息。')
  if (!file) throw new GistApiError(`该 Gist 缺少 ${GIST_SYNC_FILE_NAME}。`)
  if (file.truncated || typeof file.content !== 'string') {
    throw new GistApiError('Gist 同步文件过大或无法完整读取。')
  }

  return { id, url, document: parseGistDocument(file.content) }
}

/** 读取并校验一个已绑定的 LinkDeck Gist。 */
export async function readGist(token: string, gistId: string): Promise<RemoteGist> {
  const response = await request(`/gists/${gistId}`, token)
  return remoteFromResponse(await response.json())
}

/** 创建一个仅包含 LinkDeck 同步文件的 secret Gist。 */
export async function createGist(token: string, snapshot: CollectionSnapshot): Promise<RemoteGist> {
  const document = createGistDocument(snapshot, null)
  const response = await request('/gists', token, {
    method: 'POST',
    body: JSON.stringify({
      description: 'LinkDeck 自动同步，请勿手动修改文件格式。',
      public: false,
      files: {
        [GIST_SYNC_FILE_NAME]: { content: serializeGistDocument(document) },
      },
    }),
  })
  const created = parseGistResponse(await response.json())
  if (!created.id || !created.html_url) {
    throw new GistApiError('GitHub 创建 Gist 后未返回标识信息。')
  }
  return { id: created.id, url: created.html_url, document: clone(document) }
}

/** 使用同一个文件名更新 LinkDeck Gist 的完整同步快照。 */
export async function updateGist(
  credentials: GistCredentials,
  document: GistSyncDocument,
): Promise<void> {
  await request(`/gists/${credentials.gistId}`, credentials.token, {
    method: 'PATCH',
    body: JSON.stringify({
      files: {
        [GIST_SYNC_FILE_NAME]: { content: serializeGistDocument(document) },
      },
    }),
  })
}
