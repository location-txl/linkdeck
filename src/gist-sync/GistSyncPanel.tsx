import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { requestGistSync } from './client'
import type { BindingMode, GistBindingPreview, GistSyncViewState } from './types'

type GistSyncPanelProps = {
  onStateChange?: (state: GistSyncViewState) => void
}

function messageForState(state: GistSyncViewState): string {
  if (state.status === 'synced') {
    return state.lastSyncedAt
      ? `已同步 · ${new Date(state.lastSyncedAt).toLocaleString()}`
      : '已同步到 Gist'
  }
  if (state.status === 'syncing') return '正在同步到 Gist…'
  if (state.status === 'conflict') return `发现 ${state.conflictCount ?? 1} 个同步冲突`
  if (state.status === 'error') return state.error ?? 'Gist 同步失败。'
  return '尚未连接 Gist'
}

/** 在数据管理中配置、查看和处理 Gist 同步。 */
export function GistSyncPanel({ onStateChange }: GistSyncPanelProps) {
  const [state, setState] = useState<GistSyncViewState>({ status: 'disconnected' })
  const [token, setToken] = useState('')
  const [gistInput, setGistInput] = useState('')
  const [preview, setPreview] = useState<GistBindingPreview>()
  const [bindingMode, setBindingMode] = useState<BindingMode>()
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()

  const updateState = (next: GistSyncViewState) => {
    setState(next)
    onStateChange?.(next)
  }

  useEffect(() => {
    let active = true
    void requestGistSync({ type: 'gist-sync:get-status' }).then((response) => {
      if (!active) return
      updateState(response.state)
    })
    return () => {
      active = false
    }
  }, [])

  const connect = async () => {
    setBusy(true)
    setFormError(undefined)
    try {
      const response = await requestGistSync({
        type: 'gist-sync:connect',
        token,
        gistInput: gistInput || undefined,
      })
      updateState(response.state)
      if (!response.ok) throw new Error(response.error ?? response.state.error)
      if (response.preview) {
        setPreview(response.preview)
        setBindingMode(undefined)
      } else {
        setToken('')
        setGistInput('')
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法连接 Gist。')
    } finally {
      setBusy(false)
    }
  }

  const confirmBinding = async () => {
    if (!preview || !bindingMode) return
    setBusy(true)
    setFormError(undefined)
    try {
      const response = await requestGistSync({
        type: 'gist-sync:confirm-bind',
        token,
        gistId: preview.gistId,
        mode: bindingMode,
      })
      updateState(response.state)
      if (!response.ok) throw new Error(response.error ?? response.state.error)
      setToken('')
      setGistInput('')
      setPreview(undefined)
      setBindingMode(undefined)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法绑定 Gist。')
    } finally {
      setBusy(false)
    }
  }

  const runSync = async () => {
    setBusy(true)
    setFormError(undefined)
    try {
      const response = await requestGistSync({ type: 'gist-sync:sync-now' })
      updateState(response.state)
      if (!response.ok) throw new Error(response.error ?? response.state.error)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Gist 同步失败。')
    } finally {
      setBusy(false)
    }
  }

  const resolveConflict = async (choice: 'local' | 'remote') => {
    setBusy(true)
    setFormError(undefined)
    try {
      const response = await requestGistSync({ type: 'gist-sync:resolve-conflict', choice })
      updateState(response.state)
      if (!response.ok) throw new Error(response.error ?? response.state.error)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法处理同步冲突。')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setFormError(undefined)
    try {
      const response = await requestGistSync({ type: 'gist-sync:disconnect' })
      updateState(response.state)
      setPreview(undefined)
      setBindingMode(undefined)
      setToken('')
      setGistInput('')
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(state.gistUrl)

  return (
    <section className="gist-sync" aria-labelledby="gist-sync-title">
      <div className="gist-sync__heading">
        <div>
          <span>跨浏览器同步</span>
          <h3 id="gist-sync-title">GitHub Gist</h3>
        </div>
        <span className={`gist-sync__status gist-sync__status--${state.status}`}>
          <Icon name={state.status === 'conflict' || state.status === 'error' ? 'warning' : 'cloud'} size={14} />
          {messageForState(state)}
        </span>
      </div>

      {preview ? (
        <div className="gist-sync__preview">
          <p>
            已读取 Gist：本机 {preview.local.tags} 个标签、{preview.local.bookmarks} 个网站；
            远端 {preview.remote.tags} 个标签、{preview.remote.bookmarks} 个网站。
          </p>
          <fieldset className="import-modes">
            <legend>选择首次绑定方式</legend>
            <label className={bindingMode === 'remote' ? 'import-mode import-mode--active' : 'import-mode'}>
              <input
                type="radio"
                name="gist-bind-mode"
                checked={bindingMode === 'remote'}
                onChange={() => setBindingMode('remote')}
              />
              <span className="import-mode__radio" aria-hidden="true" />
              <span>
                <strong>使用 Gist</strong>
                <small>用远端收藏完整替换本机数据。</small>
              </span>
            </label>
            <label className={bindingMode === 'local' ? 'import-mode import-mode--active' : 'import-mode'}>
              <input
                type="radio"
                name="gist-bind-mode"
                checked={bindingMode === 'local'}
                onChange={() => setBindingMode('local')}
              />
              <span className="import-mode__radio" aria-hidden="true" />
              <span>
                <strong>使用本机</strong>
                <small>以当前收藏覆盖 Gist 内容。</small>
              </span>
            </label>
            <label className={bindingMode === 'merge' ? 'import-mode import-mode--active' : 'import-mode'}>
              <input
                type="radio"
                name="gist-bind-mode"
                checked={bindingMode === 'merge'}
                onChange={() => setBindingMode('merge')}
              />
              <span className="import-mode__radio" aria-hidden="true" />
              <span>
                <strong>智能合并</strong>
                <small>同名标签归并，重复网址保留本机内容并合并标签。</small>
              </span>
            </label>
          </fieldset>
          <div className="gist-sync__actions">
            <button
              className="button button--quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(undefined)
                setBindingMode(undefined)
              }}
            >
              返回
            </button>
            <button className="button button--ink" type="button" disabled={!bindingMode || busy} onClick={() => void confirmBinding()}>
              {busy ? '绑定中…' : '确认绑定'}
            </button>
          </div>
        </div>
      ) : connected ? (
        <div className="gist-sync__connected">
          <p>
            同步文件保存在 <a href={state.gistUrl} target="_blank" rel="noreferrer">Secret Gist</a>。令牌只保存在当前浏览器。
          </p>
          {state.status === 'conflict' && (
            <div className="gist-sync__conflict">
              <Icon name="warning" size={15} />
              <span>已安全合并非冲突改动。请选择冲突内容统一采用哪一侧。</span>
            </div>
          )}
          {state.status === 'conflict' ? (
            <div className="gist-sync__actions">
              <button className="button button--quiet" type="button" disabled={busy} onClick={() => void resolveConflict('local')}>
                保留本机冲突
              </button>
              <button className="button button--ink" type="button" disabled={busy} onClick={() => void resolveConflict('remote')}>
                采用 Gist 冲突
              </button>
            </div>
          ) : (
            <div className="gist-sync__actions">
              <button className="button button--quiet" type="button" disabled={busy} onClick={() => void runSync()}>
                {busy ? '同步中…' : '立即同步'}
              </button>
              <button className="text-button" type="button" disabled={busy} onClick={() => void disconnect()}>
                断开同步
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="gist-sync__setup">
          <label className="field">
            <span>GitHub 细粒度令牌</span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="仅授予 Gists 写入权限"
              aria-label="GitHub 细粒度令牌"
            />
          </label>
          <label className="field">
            <span>已有 Gist（可选）</span>
            <input
              type="text"
              value={gistInput}
              onChange={(event) => setGistInput(event.target.value)}
              placeholder="粘贴 Gist 链接或 ID"
              aria-label="已有 Gist"
            />
          </label>
          <p className="gist-sync__warning">
            <Icon name="warning" size={14} />
            Secret Gist 不会公开展示或搜索，但拿到链接的人仍能读取明文收藏。
          </p>
          <div className="gist-sync__actions">
            <button className="button button--ink" type="button" disabled={!token.trim() || busy} onClick={() => void connect()}>
              {busy ? '连接中…' : gistInput.trim() ? '检查并绑定 Gist' : '创建 Secret Gist'}
            </button>
          </div>
        </div>
      )}
      {formError && <p className="form__error">{formError}</p>}
    </section>
  )
}
