import type { BindingMode, BindingPreview, ConflictChoice, GitHubSyncViewState } from './types'

type BindingInput = { token: string; repositoryInput: string }

export type GitHubSyncMessage =
  | { type: 'github-sync:get-status' }
  | { type: 'github-sync:sync-now' }
  | ({ type: 'github-sync:preview' } & BindingInput)
  | ({ type: 'github-sync:confirm-bind'; version: string; mode: BindingMode } & BindingInput)
  | { type: 'github-sync:resolve-conflict'; choice: ConflictChoice }
  | { type: 'github-sync:disconnect' }

export type GitHubSyncResponse = {
  ok: boolean
  state: GitHubSyncViewState
  error?: string
  preview?: BindingPreview
}

export function isGitHubSyncMessage(value: unknown): value is GitHubSyncMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  switch (value.type) {
    case 'github-sync:get-status':
    case 'github-sync:sync-now':
    case 'github-sync:disconnect':
      return true
    case 'github-sync:preview':
    case 'github-sync:confirm-bind':
      if (!('token' in value) || typeof value.token !== 'string' ||
        !('repositoryInput' in value) || typeof value.repositoryInput !== 'string') return false
      return value.type === 'github-sync:preview' ||
        ('version' in value && typeof value.version === 'string' &&
          'mode' in value && (value.mode === 'remote' || value.mode === 'local' || value.mode === 'merge'))
    case 'github-sync:resolve-conflict':
      return 'choice' in value && (value.choice === 'local' || value.choice === 'remote')
    default:
      return false
  }
}
