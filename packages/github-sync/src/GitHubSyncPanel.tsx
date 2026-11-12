import { useState } from 'react'
import { Icon } from '@linkdeck/ui/icon'
import { requestGitHubSync } from './client'
import type { GitHubSyncMessage } from './messages'
import type { BindingMode, BindingPreview, GitHubSyncViewState } from './types'

type GitHubSyncPanelProps = {
  state: GitHubSyncViewState
  onStateChange: (state: GitHubSyncViewState) => void
}

const bindingModes: { value: BindingMode; label: string; description: string }[] = [
  { value: 'remote', label: '使用远端', description: '用仓库里的收藏完整替换本机数据。' },
  { value: 'local', label: '使用本机', description: '用本机收藏覆盖仓库里的同步文件。' },
  { value: 'merge', label: '智能合并', description: '归并同名标签，重复网址保留本机内容并合并标签。' },
]

function messageForState(state: GitHubSyncViewState): string {
  if (state.status === 'synced') {
    return state.lastSyncedAt
      ? '已同步 · ' + new Date(state.lastSyncedAt).toLocaleString()
      : '已同步到 GitHub'
  }
  if (state.status === 'syncing') return '正在同步…'
  if (state.status === 'conflict') return state.conflictCount ? '发现 ' + state.conflictCount + ' 个同步冲突' : '等待确认'
  if (state.status === 'error') return '同步失败'
  return '尚未启用'
}

export function GitHubSyncPanel({ state, onStateChange }: GitHubSyncPanelProps) {
  const [token, setToken] = useState('')
  const [repositoryInput, setRepositoryInput] = useState('')
  const [preview, setPreview] = useState<BindingPreview>()
  const [bindingMode, setBindingMode] = useState<BindingMode>()
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()

  const run = async (message: GitHubSyncMessage) => {
    setBusy(true)
    setFormError(undefined)
    try {
      const response = await requestGitHubSync(message)
      if (response.ok || response.state.repositoryUrl) onStateChange(response.state)
      setFormError(response.error)
      if (!response.ok) return

      if (response.preview) {
        setPreview(response.preview)
        setBindingMode(undefined)
      } else if (message.type === 'github-sync:confirm-bind' || message.type === 'github-sync:disconnect') {
        setPreview(undefined)
        setBindingMode(undefined)
        setToken('')
        setRepositoryInput('')
      }
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(state.repositoryUrl)
  const mode = preview?.remote ? bindingMode : 'local'

  return (
    <section className="github-sync" aria-labelledby="github-sync-title">
      <div className="github-sync__heading">
        <div>
          <span>跨浏览器同步</span>
          <h3 id="github-sync-title">GitHub 私有仓库</h3>
        </div>
        <span className={'github-sync__status github-sync__status--' + state.status}>
          <Icon name={state.status === 'conflict' || state.status === 'error' ? 'warning' : 'cloud'} size={14} />
          {messageForState(state)}
        </span>
      </div>

      {!connected && preview ? (
        <div className="github-sync__preview">
          <p>
            本机有 {preview.local.tags} 个标签、{preview.local.bookmarks} 个网站。
            {preview.remote
              ? '仓库有 ' + preview.remote.tags + ' 个标签、' + preview.remote.bookmarks + ' 个网站。'
              : '确认后将把本机收藏上传至 ' + preview.repositoryName + '。'}
          </p>
          {preview.remote && (
            <fieldset className="import-modes">
              <legend>选择首次绑定方式</legend>
              {bindingModes.map(({ value, label, description }) => (
                <label key={value} className={bindingMode === value ? 'import-mode import-mode--active' : 'import-mode'}>
                  <input
                    type="radio"
                    name="github-bind-mode"
                    checked={bindingMode === value}
                    onChange={() => setBindingMode(value)}
                  />
                  <span className="import-mode__radio" aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="github-sync__actions">
            <button
              className="button button--quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(undefined)
                setBindingMode(undefined)
                setFormError(undefined)
              }}
            >
              返回
            </button>
            <button
              className="button button--ink"
              type="button"
              disabled={!mode || busy}
              onClick={() => mode && void run({ type: 'github-sync:confirm-bind', token, repositoryInput, version: preview.version, mode })}
            >
              {busy ? '绑定中…' : preview.remote ? '确认绑定' : '上传本机并启用'}
            </button>
          </div>
        </div>
      ) : connected ? (
        <div className="github-sync__connected">
          <p>同步仓库 <a href={state.repositoryUrl} target="_blank" rel="noreferrer">{state.repositoryUrl?.replace('https://github.com/', '')}</a></p>
          {state.status === 'conflict' && (
            <div className="github-sync__conflict">
              <Icon name="warning" size={15} />
              <span>{state.error ?? '请选择冲突内容采用哪一侧。独立改动会自动合并。'}</span>
            </div>
          )}
          <div className="github-sync__actions">
            {state.status === 'conflict' ? (
              <>
                <button className="button button--quiet" type="button" disabled={busy} onClick={() => void run({ type: 'github-sync:resolve-conflict', choice: 'local' })}>
                  保留本机冲突
                </button>
                <button className="button button--ink" type="button" disabled={busy} onClick={() => void run({ type: 'github-sync:resolve-conflict', choice: 'remote' })}>
                  采用远端冲突
                </button>
              </>
            ) : (
              <button className="button button--quiet" type="button" disabled={busy} onClick={() => void run({ type: 'github-sync:sync-now' })}>
                立即同步
              </button>
            )}
            <button className="text-button" type="button" disabled={busy} onClick={() => void run({ type: 'github-sync:disconnect' })}>
              断开同步
            </button>
          </div>
        </div>
      ) : (
        <div className="github-sync__setup">
          <label className="field">
            <span>GitHub 私有仓库地址</span>
            <input
              type="text"
              value={repositoryInput}
              onChange={(event) => setRepositoryInput(event.target.value)}
              placeholder="owner/repo 或 GitHub 仓库链接"
            />
          </label>
          <label className="field">
            <span>GitHub 细粒度令牌</span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Contents: Read and write"
            />
          </label>
          <p className="github-sync__setup-note">令牌只需授权这个私有仓库，保存在当前浏览器。</p>
          <div className="github-sync__actions">
            <button
              className="button button--ink"
              type="button"
              disabled={!token.trim() || !repositoryInput.trim() || busy}
              onClick={() => void run({ type: 'github-sync:preview', token, repositoryInput })}
            >
              {busy ? '检查中…' : '检查仓库'}
            </button>
          </div>
        </div>
      )}
      {(formError || (state.status === 'error' && state.error)) && (
        <p className="form__error" role="alert">{formError || state.error}</p>
      )}
    </section>
  )
}
