import { useEffect, useState } from 'react'
import { isXBookmarkEnabled, setXBookmarkEnabled } from './preferences'
import { X_ORIGIN, X_BOOKMARK_KEY } from './messages'

export function XBookmarkSettingsPanel() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const available = typeof chrome !== 'undefined' && Boolean(chrome.permissions?.request)
  useEffect(() => {
    if (!available) return
    let alive = true
    const refresh = () => {
      void isXBookmarkEnabled().then((value) => { if (alive) setEnabled(value) })
        .catch(() => { if (alive) setError('读取 X 收藏设置失败。') })
        .finally(() => { if (alive) setLoading(false) })
    }
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[X_BOOKMARK_KEY]) refresh()
    }
    refresh()
    chrome.permissions.onAdded.addListener(refresh)
    chrome.permissions.onRemoved.addListener(refresh)
    chrome.storage.onChanged.addListener(changed)
    return () => {
      alive = false
      chrome.permissions.onAdded.removeListener(refresh)
      chrome.permissions.onRemoved.removeListener(refresh)
      chrome.storage.onChanged.removeListener(changed)
    }
  }, [available])

  const toggle = async () => {
    const next = !enabled
    setSaving(true)
    setError('')
    try {
      if (next && !await chrome.permissions.request({ origins: [X_ORIGIN] })) throw new Error('未获得 X 网站权限，功能没有启用。')
      await setXBookmarkEnabled(next)
      setEnabled(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存设置失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings__section" aria-labelledby="x-bookmark-title">
      <h3 id="x-bookmark-title">X 书签联动</h3>
      <label className="settings__option">
        <input type="checkbox" checked={enabled} disabled={loading || saving || !available} onChange={() => void toggle()} />
        <span><strong>保存 X 书签时同时收藏到 LinkDeck</strong><small>主动添加 X 书签后，同步收藏帖子并添加「X」标签；取消书签不会删除 LinkDeck 收藏。仅请求 x.com 网站权限。</small></span>
      </label>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
