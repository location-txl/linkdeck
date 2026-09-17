import { useEffect, useState, type MouseEvent } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { Favicon } from '../components/Favicon'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
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
 * 展示自动关闭功能的关闭历史。
 *
 * 历史只保存在本浏览器：点击条目会重新打开页面，记录本身保留为日志；清除需二次确认。
 */
export function CloseHistoryModal({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<AutoCloseHistoryEntry[]>()
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let alive = true
    void getAutoCloseHistory()
      .then((entries) => {
        if (alive) setHistory(entries)
      })
      .catch((caught: unknown) => {
        if (alive) {
          setError(errorMessage(caught))
          setHistory([])
        }
      })
    return () => {
      alive = false
    }
  }, [])

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
    <Modal title="关闭历史" onClose={() => { if (!confirming) onClose() }} size="wide">
      <div className="close-history">
        <p className="close-history__hint">闲置标签页被自动关闭后会记录在这里，点击条目可重新打开。历史只保存在本浏览器。</p>
        {history === undefined ? (
          <div className="close-history__list close-history__list--loading" role="status"><span>正在读取关闭历史…</span></div>
        ) : history.length === 0 ? (
          <div className="empty-state empty-state--history"><span className="empty-state__mark"><Icon name="history" size={23} /></span><h3>暂无关闭记录</h3><p>开启自动关闭闲置标签页后，被关闭的页面会出现在这里。</p></div>
        ) : (
          <div className="close-history__list" role="list">
            {history.map((entry, index) => (
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
        <footer className="close-history__footer">
          <button className="button button--quiet" type="button" disabled={!history || history.length === 0} onClick={() => setConfirming(true)}>清除历史</button>
          <button className="button button--ink" type="button" onClick={onClose}>完成</button>
        </footer>
      </div>
      {confirming && (
        <ConfirmModal title="清除关闭历史" mark="trash" onClose={() => setConfirming(false)} onConfirm={clear} confirmLabel="清除历史">
          <p>确定清除全部 <strong>{history?.length ?? 0}</strong> 条关闭记录吗？此操作无法撤销。</p>
        </ConfirmModal>
      )}
    </Modal>
  )
}
