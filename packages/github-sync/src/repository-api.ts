import type { CollectionSnapshot } from '@linkdeck/bookmarks'
import { parseBackupJson, serializeBackup, validateSnapshotCapacity } from '@linkdeck/data-transfer'
import { UserFacingError } from '@linkdeck/shared'
import { GITHUB_SYNC_FILE_NAME, type RepositoryCredentials, type RepositoryTarget } from './types'

const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_API_VERSION = '2026-03-10'
const REPOSITORY_NAME = /^([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)$/

export type RemoteFile = { sha: string; snapshot: CollectionSnapshot }

export class RepositoryApiError extends UserFacingError {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function parseRepositoryName(input: string): string {
  const value = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/i, '')
  const match = REPOSITORY_NAME.exec(value)
  if (!match || match[2] === '.' || match[2] === '..') {
    throw new UserFacingError('请输入 owner/repo 或完整的 GitHub 仓库链接。')
  }
  return value
}

function errorForStatus(status: number): RepositoryApiError {
  if (status === 401) return new RepositoryApiError('GitHub 令牌无效或已过期。', status)
  if (status === 403) return new RepositoryApiError('GitHub 拒绝访问，请检查仓库授权、Contents 权限和分支规则。', status)
  if (status === 404) return new RepositoryApiError('找不到 GitHub 仓库或文件，请检查地址及令牌权限。', status)
  if (status === 409 || status === 422) {
    return new RepositoryApiError('GitHub 无法写入同步文件，请检查分支规则后重试。', status)
  }
  if (status === 429) return new RepositoryApiError('GitHub 请求过于频繁，请稍后重试。', status)
  if (status >= 500) return new RepositoryApiError('GitHub 服务暂时不可用，请稍后重试。', status)
  return new RepositoryApiError('GitHub 同步请求失败（HTTP ' + status + '）。', status)
}

async function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    return await fetch(GITHUB_API_URL + path, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    })
  } catch {
    throw new UserFacingError(controller.signal.aborted ? '连接 GitHub 超时，请稍后重试。' : '无法连接 GitHub，请检查网络和仓库地址。')
  } finally {
    clearTimeout(timeout)
  }
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw errorForStatus(response.status)
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserFacingError('GitHub 返回的数据格式不正确。')
  }
  return value as Record<string, unknown>
}

export async function readRepository(token: string, fullName: string): Promise<RepositoryTarget> {
  const data = await readObject(await request('/repos/' + fullName, token))
  if (data.private !== true || data.visibility !== 'private') {
    throw new UserFacingError('只支持 GitHub 私有仓库，请确认仓库可见性。')
  }
  if (typeof data.id !== 'number' || typeof data.full_name !== 'string' ||
    data.full_name.toLowerCase() !== fullName.toLowerCase() ||
    typeof data.default_branch !== 'string' || !data.default_branch) {
    throw new UserFacingError('无法确认 GitHub 仓库及其默认分支。')
  }
  return { id: data.id, fullName: data.full_name, branch: data.default_branch }
}

export async function verifyRepository(credentials: RepositoryCredentials): Promise<RepositoryTarget> {
  const current = await readRepository(credentials.token, credentials.repository.fullName)
  if (current.id !== credentials.repository.id) {
    throw new UserFacingError('GitHub 仓库已更换，请断开后重新绑定。')
  }
  return current
}

export async function readRepositoryFile({ token, repository }: RepositoryCredentials): Promise<RemoteFile | null> {
  const response = await request(
    '/repos/' + repository.fullName + '/contents/' + GITHUB_SYNC_FILE_NAME + '?ref=' + encodeURIComponent(repository.branch),
    token,
  )
  if (response.status === 404) return null
  const file = await readObject(response)
  if (file.type !== 'file' || file.encoding !== 'base64' ||
    typeof file.content !== 'string' || typeof file.sha !== 'string' || !file.sha) {
    throw new UserFacingError('无法读取仓库中的 ' + GITHUB_SYNC_FILE_NAME + '。')
  }

  let json: string
  try {
    const bytes = Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0))
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new UserFacingError('仓库中的同步文件编码无效。')
  }
  return { sha: file.sha, snapshot: parseBackupJson(json).data }
}

export async function writeRepositoryFile(
  credentials: RepositoryCredentials,
  snapshot: CollectionSnapshot,
  sha: string | null,
): Promise<void> {
  validateSnapshotCapacity(snapshot)
  const current = await verifyRepository(credentials)
  const { repository, token } = credentials
  if (sha === null && current.branch !== repository.branch) {
    throw new UserFacingError('仓库默认分支已变化，请重新检查仓库。')
  }
  const bytes = new TextEncoder().encode(serializeBackup(snapshot))
  const content = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  const response = await request('/repos/' + repository.fullName + '/contents/' + GITHUB_SYNC_FILE_NAME, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Sync LinkDeck bookmarks',
      content,
      // 省略分支可让 GitHub 为完全空的仓库初始化默认分支。
      ...(sha === null ? {} : { branch: repository.branch, sha }),
    }),
  })
  if (!response.ok) throw errorForStatus(response.status)
}
