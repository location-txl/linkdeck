import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { Favicon } from '../components/Favicon'
import { Icon } from '../components/Icon'
import { openBookmark } from '../lib/chrome-api'
import { getHostname } from '../lib/bookmark-utils'
import { clearAutoCloseHistory, getAutoCloseHistory } from './preferences'
import type { AutoCloseHistoryEntry } from '../types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '出现未知错误，请稍后重试。'
}

function displayTitle(entry: AutoCloseHistoryEntry): string {
  return entry.title || getHostname(entry.url) || entry.url
}

function eventHint(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘ 点击可在后台' : 'Ctrl 点击可在后台'
}

/**
 * 独立标签页展示自动关闭功能的关闭历史。
 *
 * 历史只保存在本浏览器：点击条目会重新打开页面，记录本身保留为日志；清除需二次确认，可随时手动刷新。
 */
export function CloseHistoryPage() {
  const [history, setHistory] = useState<AutoCloseHistoryEntry[]>()
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setError(undefined)
    try {
      setHistory(await getAutoCloseHistory())
    } catch (caught) {
      setError(errorMessage(caught))
      setHistory([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, reloadToken])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'f') return
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const searchTerm = searchQuery.trim().toLocaleLowerCase()
  const isSearching = searchTerm.length > 0
  const visibleEntries = useMemo(() => {
    if (!history) return []
    if (!isSearching) return history
    return history.filter((entry) =>
      entry.title.toLocaleLowerCase().includes(searchTerm) || entry.url.toLocaleLowerCase().includes(searchTerm))
  }, [history, isSearching, searchTerm])

  const open = async (entry: AutoCloseHistoryEntry, background: boolean) => {
    setError(undefined)
    try {
      await openBookmark(entry.url, background)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const clear = async () => {
    setError(undefined)
    try {
      await clearAutoCloseHistory()
      setHistory([])
      setConfirming(false)
    } catch (caught) {
      setConfirming(false)
      setError(errorMessage(caught))
    }
  }

  return (
    <main className="app-shell app-shell--history">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><Icon name="deck" size={20} /></span>
          <div><span className="brand__eyebrow">CLOSE HISTORY</span><h1>LinkDeck</h1></div>
        </div>
        <div className="topbar__actions">
          <button className="icon-button" type="button" onClick={() => setReloadToken((token) => token + 1)} aria-label="刷新" title="刷新"><Icon name="refresh" /></button>
        </div>
      </header>

      <section className="close-history close-history--page" aria-labelledby="close-history-title">
        <div className="close-history__heading">
          <div>
            <span className="close-history__label"><Icon name="history" size={14} />自动关闭</span>
            <h2 id="close-history-title">{history === undefined ? '关闭历史' : isSearching ? `${visibleEntries.length} 条结果` : `关闭历史 · ${history.length}`}</h2>
          </div>
          <button className="text-button" type="button" disabled={!history || history.length === 0} onClick={() => setConfirming(true)}>清除历史<Icon name="trash" size={15} /></button>
        </div>
        <p className="close-history__hint">闲置标签页被自动关闭后会记录在这里，点击条目可重新打开。历史只保存在本浏览器，不会参与同步。</p>
        <div className="search-field" role="search">
          <Icon className="search-field__icon" name="search" size={16} />
          <input ref={searchInputRef} type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索标题或网址" aria-label="搜索关闭历史" aria-keyshortcuts="Meta+F Control+F" title="按 ⌘F 搜索" />
          {searchQuery && <button className="search-field__clear" type="button" onClick={() => setSearchQuery('')} aria-label="清除搜索" title="清除搜索"><Icon name="close" size={14} /></button>}
        </div>
        {history === undefined ? (
          <div className="close-history__list close-history__list--loading" role="status"><span>正在读取关闭历史…</span></div>
        ) : isSearching && visibleEntries.length === 0 ? (
          <div className="empty-state empty-state--search"><span className="empty-state__mark"><Icon name="search" size={23} /></span><h3>没有找到“{searchQuery.trim()}”</h3><p>试试其他关键词，或刷新后重试。</p><button className="button button--quiet" type="button" onClick={() => setSearchQuery('')}>清除搜索</button></div>
        ) : visibleEntries.length === 0 ? (
          <div className="empty-state empty-state--history"><span className="empty-state__mark"><Icon name="history" size={23} /></span><h3>暂无关闭记录</h3><p>开启自动关闭闲置标签页后，被关闭的页面会出现在这里。</p></div>
        ) : (
          <div className="close-history__list" role="list">
            {visibleEntries.map((entry, index) => (
              <button
                key={`${entry.url}:${entry.closedAt}:${index}`}
                className="close-history__row"
                type="button"
                role="listitem"
                aria-label={`打开 ${displayTitle(entry)}`}
                title={`${eventHint()}打开 ${displayTitle(entry)}`}
                onClick={(event: MouseEvent<HTMLButtonElement>) => void open(entry, event.metaKey || event.ctrlKey)}
              >
                <Favicon url={entry.url} />
                <span className="close-history__copy"><strong>{displayTitle(entry)}</strong><small>{getHostname(entry.url)}</small></span>
                <time className="close-history__time" dateTime={new Date(entry.closedAt).toISOString()}>{new Date(entry.closedAt).toLocaleString()}</time>
                <Icon name="arrow-up-right" size={16} />
              </button>
            ))}
          </div>
        )}
        {error && <p className="form__error" role="alert">{error}</p>}
      </section>

      <footer className="privacy-note"><Icon name="globe" size={14} /><span>关闭历史仅保存在本浏览器</span></footer>

      {confirming && (
        <ConfirmModal title="清除关闭历史" mark="trash" onClose={() => setConfirming(false)} onConfirm={clear} confirmLabel="清除历史">
          <p>确定清除全部 <strong>{history?.length ?? 0}</strong> 条关闭记录吗？此操作无法撤销。</p>
        </ConfirmModal>
      )}
    </main>
  )
}
