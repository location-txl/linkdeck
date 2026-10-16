import type { BindingMode, ConflictChoice, GistBindingPreview, GistSyncViewState } from './types'

/** popup 与后台同步 worker 之间允许的消息。 */
export type GistSyncMessage =
  | { type: 'gist-sync:get-status' }
  | { type: 'gist-sync:sync-now' }
  | { type: 'gist-sync:connect'; token: string; gistInput?: string }
  | { type: 'gist-sync:confirm-bind'; token: string; gistId: string; mode: BindingMode }
  | { type: 'gist-sync:resolve-conflict'; choice: ConflictChoice }
  | { type: 'gist-sync:disconnect' }

/** 所有同步消息统一返回状态，失败时不暴露令牌或远端原始数据。 */
export type GistSyncResponse = {
  ok: boolean
  state: GistSyncViewState
  error?: string
  preview?: GistBindingPreview
}

export function isGistSyncMessage(value: unknown): value is GistSyncMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  return typeof value.type === 'string' && value.type.startsWith('gist-sync:')
}
