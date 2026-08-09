import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Favicon } from './components/Favicon'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { DataTransferModal } from './data-transfer/DataTransferModal'
import { getCurrentPageDraft, openBookmark } from './lib/chrome-api'
import { bookmarkRepository } from './lib/bookmark-repository'
import { getHostname, UserFacingError } from './lib/bookmark-utils'
import { getSelectedGroupId, setSelectedGroupId as saveSelectedGroupId } from './lib/preferences'
import type { Bookmark, BookmarkDraft, CollectionSnapshot, Group, ImportMode, ImportSummary } from './types'

type BookmarkModalState =
  | {
      mode: 'create'
      initial: BookmarkDraft
    }
  | {
      mode: 'edit'
      bookmark: Bookmark
      initial: BookmarkDraft
    }

type GroupFormState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      group: Group
    }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '出现未知错误，请稍后重试。'
}

function getBookmarkDraft(bookmark: Bookmark): BookmarkDraft {
  return {
    title: bookmark.title,
    url: bookmark.url,
    groupId: bookmark.groupId,
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<CollectionSnapshot | null>(null)
  const [selectedGroupId, setSelectedGroup] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [bookmarkModal, setBookmarkModal] = useState<BookmarkModalState>()
  const [groupForm, setGroupForm] = useState<GroupFormState>()
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [dataManagerOpen, setDataManagerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Bookmark>()
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const next = await bookmarkRepository.load()
    setSnapshot(next)
    setSelectedGroup((current) => {
      const usable = current && next.meta.groups.some((group) => group.id === current)
      const resolved = usable ? current : next.meta.groups[0]?.id
      if (resolved && resolved !== current) {
        void saveSelectedGroupId(resolved)
      }
      return resolved
    })
    return next
  }, [])

  useEffect(() => {
    let alive = true

    const initialize = async () => {
      try {
        const [next, preferredGroupId] = await Promise.all([
          bookmarkRepository.load(),
          getSelectedGroupId(),
        ])
        if (!alive) return

        setSnapshot(next)
        const groupId =
          preferredGroupId && next.meta.groups.some((group) => group.id === preferredGroupId)
            ? preferredGroupId
            : next.meta.groups[0]?.id
        setSelectedGroup(groupId)
        if (groupId) void saveSelectedGroupId(groupId)
      } catch (caught) {
        if (alive) setError(errorMessage(caught))
      }
    }

    void initialize()
    const unsubscribe = bookmarkRepository.subscribe(
      (next) => {
        if (!alive) return
        setSnapshot(next)
        setSelectedGroup((current) => {
          const usable = current && next.meta.groups.some((group) => group.id === current)
          const resolved = usable ? current : next.meta.groups[0]?.id
          if (resolved && resolved !== current) void saveSelectedGroupId(resolved)
          return resolved
        })
      },
      (caught) => {
        if (alive) setError(errorMessage(caught))
      },
    )

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(undefined), 2_400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'f') return

      const input = searchInputRef.current
      if (!input) return

      event.preventDefault()
      input.focus()
      input.select()
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const runMutation = useCallback(
    async (operation: () => Promise<unknown>, successMessage: string) => {
      setError(undefined)
      try {
        await operation()
        await refresh()
        setNotice(successMessage)
      } catch (caught) {
        const message = errorMessage(caught)
        setError(message)
        throw new UserFacingError(message)
      }
    },
    [refresh],
  )

  const activeGroup = useMemo(() => {
    if (!snapshot) return undefined
    return (
      snapshot.meta.groups.find((group) => group.id === selectedGroupId) ??
      snapshot.meta.groups[0]
    )
  }, [selectedGroupId, snapshot])

  const activeBookmarks = useMemo(
    () =>
      activeGroup && snapshot
        ? snapshot.bookmarks.filter((bookmark) => bookmark.groupId === activeGroup.id)
        : [],
    [activeGroup, snapshot],
  )

  const searchTerm = useMemo(() => searchQuery.trim().toLocaleLowerCase(), [searchQuery])
  const isSearching = searchTerm.length > 0

  const visibleBookmarks = useMemo(() => {
    if (!snapshot || !isSearching) return activeBookmarks

    return snapshot.bookmarks.filter((bookmark) => {
      return (
        bookmark.title.toLocaleLowerCase().includes(searchTerm) ||
        bookmark.url.toLocaleLowerCase().includes(searchTerm)
      )
    })
  }, [activeBookmarks, isSearching, searchTerm, snapshot])

  const groupNames = useMemo(
    () => new Map(snapshot?.meta.groups.map((group) => [group.id, group.name])),
    [snapshot],
  )

  const selectGroup = (groupId: string) => {
    setSelectedGroup(groupId)
    void saveSelectedGroupId(groupId)
  }

  const openManualForm = () => {
    if (!activeGroup) return
    setBookmarkModal({
      mode: 'create',
      initial: { title: '', url: '', groupId: activeGroup.id },
    })
  }

  const openCurrentPageForm = async () => {
    if (!activeGroup) return
    setError(undefined)
    try {
      const draft = await getCurrentPageDraft(activeGroup.id)
      setBookmarkModal({ mode: 'create', initial: draft })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const saveBookmark = async (draft: BookmarkDraft) => {
    if (bookmarkModal?.mode === 'edit') {
      await runMutation(
        () => bookmarkRepository.updateBookmark(bookmarkModal.bookmark.id, draft),
        '网站已更新。',
      )
      return
    }

    await runMutation(() => bookmarkRepository.createBookmark(draft), '已添加到 LinkDeck。')
  }

  const saveGroup = async (name: string) => {
    if (groupForm?.mode === 'edit') {
      await runMutation(
        () => bookmarkRepository.renameGroup(groupForm.group.id, name),
        '分组名称已更新。',
      )
      return
    }

    const createdGroup = await bookmarkRepository.createGroup(name)
    await refresh()
    selectGroup(createdGroup.id)
    setNotice('已创建新分组。')
  }

  const importData = async (imported: CollectionSnapshot, mode: ImportMode) => {
    setError(undefined)
    try {
      const summary = await bookmarkRepository.importSnapshot(imported, mode)
      const next = await refresh()
      if (mode === 'replace' && next.meta.groups[0]) selectGroup(next.meta.groups[0].id)
      setDataManagerOpen(false)
      setNotice(importNotice(summary))
    } catch (caught) {
      throw new UserFacingError(errorMessage(caught))
    }
  }

  if (!snapshot || !activeGroup) {
    return (
      <main className="app-shell app-shell--loading">
        <div className="loading-card">
          <span className="loading-card__mark">
            <Icon name="deck" size={22} />
          </span>
          <span>正在整理你的链接…</span>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="deck" size={20} />
          </span>
          <div>
            <span className="brand__eyebrow">PERSONAL LINKS</span>
            <h1>LinkDeck</h1>
          </div>
        </div>
        <div className="topbar__actions">
          <span className="sync-state" title="已保存到浏览器同步存储">
            <Icon name="cloud" size={15} />
            <span>已保存</span>
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => setDataManagerOpen(true)}
            aria-label="数据管理"
            title="数据管理"
          >
            <Icon name="more" />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setGroupManagerOpen(true)}
            aria-label="管理分组"
            title="管理分组"
          >
            <Icon name="layers" />
          </button>
          <button
            className="icon-button icon-button--accent"
            type="button"
            onClick={openManualForm}
            aria-label="手动添加网站"
            title="手动添加网站"
          >
            <Icon name="add" />
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className={error ? 'message message--error' : 'message message--notice'} role="status">
          <Icon name={error ? 'warning' : 'check'} size={15} />
          <span>{error ?? notice}</span>
          {error && (
            <button
              className="message__close"
              type="button"
              onClick={() => setError(undefined)}
              aria-label="关闭提示"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}

      <section className="collection-bar" aria-label="分组导航">
        <div className="collection-bar__heading">
          <span>收藏卡组</span>
          <b>{snapshot.bookmarks.length}</b>
        </div>
        <button className="current-page-button" type="button" onClick={() => void openCurrentPageForm()}>
          <Icon name="bookmark-add" size={16} />
          收藏当前页
        </button>
      </section>

      <nav className="group-tabs" aria-label="收藏分组">
        {snapshot.meta.groups.map((group) => {
          const count = snapshot.bookmarks.filter((bookmark) => bookmark.groupId === group.id).length
          const active = group.id === activeGroup.id
          return (
            <button
              key={group.id}
              className={`group-tab ${active ? 'group-tab--active' : ''}`}
              type="button"
              aria-pressed={active}
              onClick={() => selectGroup(group.id)}
            >
              <span>{group.name}</span>
              <em>{count}</em>
            </button>
          )
        })}
        <button
          className="group-tab group-tab--add"
          type="button"
          onClick={() => setGroupForm({ mode: 'create' })}
          aria-label="新建分组"
          title="新建分组"
        >
          <Icon name="add" size={16} />
        </button>
      </nav>

      <div className="search-field" role="search">
        <Icon className="search-field__icon" name="search" size={16} />
        <input
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索名称或网址"
          aria-label="搜索收藏"
          aria-keyshortcuts="Meta+F Control+F"
          title="按 ⌘F 搜索"
        />
        {searchQuery && (
          <button
            className="search-field__clear"
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="清除搜索"
            title="清除搜索"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <section className="bookmarks">
        <div className="bookmarks__heading">
          <div>
            <span className="bookmarks__label">
              <Icon name={isSearching ? 'search' : 'folder'} size={14} />
              {isSearching ? '搜索结果' : '当前分组'}
            </span>
            <h2>{isSearching ? `${visibleBookmarks.length} 条结果` : activeGroup.name}</h2>
          </div>
          {!isSearching && (
            <button
              className="text-button"
              type="button"
              onClick={() => setGroupManagerOpen(true)}
            >
              管理
              <Icon name="chevron-right" size={15} />
            </button>
          )}
        </div>

        {visibleBookmarks.length > 0 ? (
          <div className="bookmark-list">
            {visibleBookmarks.map((bookmark) => (
              <article className="bookmark-row" key={bookmark.id}>
                <button
                  className="bookmark-row__open"
                  type="button"
                  onClick={(event) => void openBookmark(bookmark.url, event.metaKey || event.ctrlKey)}
                  title={`${eventHint()}打开 ${bookmark.title}`}
                >
                  <Favicon url={bookmark.url} />
                  <span className="bookmark-row__copy">
                    <strong>{bookmark.title}</strong>
                    <small>{getHostname(bookmark.url)}</small>
                    {isSearching && (
                      <span className="bookmark-row__group">
                        {groupNames.get(bookmark.groupId)}
                      </span>
                    )}
                  </span>
                  <Icon name="arrow-up-right" size={16} />
                </button>
                <button
                  className="bookmark-row__edit icon-button"
                  type="button"
                  aria-label={`编辑 ${bookmark.title}`}
                  title="编辑网站"
                  onClick={() =>
                    setBookmarkModal({
                      mode: 'edit',
                      bookmark,
                      initial: getBookmarkDraft(bookmark),
                    })
                  }
                >
                  <Icon name="edit" size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : isSearching ? (
          <SearchEmptyState query={searchQuery.trim()} onClear={() => setSearchQuery('')} />
        ) : (
          <EmptyState onAddCurrent={() => void openCurrentPageForm()} onAddManual={openManualForm} />
        )}
      </section>

      <footer className="privacy-note">
        <Icon name="globe" size={14} />
        <span>网站图标会从 favicon.im 获取</span>
      </footer>

      {bookmarkModal && (
        <BookmarkFormModal
          key={bookmarkModal.mode === 'edit' ? bookmarkModal.bookmark.id : 'create'}
          mode={bookmarkModal.mode}
          initial={bookmarkModal.initial}
          groups={snapshot.meta.groups}
          onClose={() => setBookmarkModal(undefined)}
          onSave={saveBookmark}
          onRequestDelete={
            bookmarkModal.mode === 'edit'
              ? () => {
                  setDeleteTarget(bookmarkModal.bookmark)
                  setBookmarkModal(undefined)
                }
              : undefined
          }
        />
      )}

      {dataManagerOpen && (
        <DataTransferModal
          snapshot={snapshot}
          onClose={() => setDataManagerOpen(false)}
          onExported={(filename) => {
            setDataManagerOpen(false)
            setNotice(`已导出 ${filename}。`)
          }}
          onImport={importData}
        />
      )}

      {groupManagerOpen && (
        <GroupManagerModal
          groups={snapshot.meta.groups}
          bookmarks={snapshot.bookmarks}
          activeGroupId={activeGroup.id}
          onClose={() => setGroupManagerOpen(false)}
          onSelect={(groupId) => {
            selectGroup(groupId)
            setGroupManagerOpen(false)
          }}
          onAdd={() => {
            setGroupManagerOpen(false)
            setGroupForm({ mode: 'create' })
          }}
          onEdit={(group) => {
            setGroupManagerOpen(false)
            setGroupForm({ mode: 'edit', group })
          }}
          onDelete={(groupId) =>
            runMutation(() => bookmarkRepository.deleteGroup(groupId), '已删除空分组。')
          }
        />
      )}

      {groupForm && (
        <GroupFormModal
          key={groupForm.mode === 'edit' ? groupForm.group.id : 'create'}
          mode={groupForm.mode}
          initialName={groupForm.mode === 'edit' ? groupForm.group.name : ''}
          onClose={() => setGroupForm(undefined)}
          onSave={saveGroup}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          bookmark={deleteTarget}
          onClose={() => setDeleteTarget(undefined)}
          onConfirm={async () => {
            await runMutation(
              () => bookmarkRepository.deleteBookmark(deleteTarget.id),
              '网站已删除。',
            )
            setDeleteTarget(undefined)
          }}
        />
      )}
    </main>
  )
}

function eventHint(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘ 点击可在后台' : 'Ctrl 点击可在后台'
}

function importNotice(summary: ImportSummary): string {
  const imported = `已导入 ${summary.groupsAdded} 个分组和 ${summary.bookmarksAdded} 个网站。`
  return summary.bookmarksSkipped > 0
    ? `${imported} 跳过 ${summary.bookmarksSkipped} 个重复网站。`
    : imported
}

function EmptyState({
  onAddCurrent,
  onAddManual,
}: {
  onAddCurrent: () => void
  onAddManual: () => void
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__mark" aria-hidden="true">
        <Icon name="link" size={23} />
      </span>
      <h3>这一组还是空的</h3>
      <p>把常用网站收进这里，打开时就不用再翻书签。</p>
      <div className="empty-state__actions">
        <button className="button button--ink" type="button" onClick={onAddCurrent}>
          <Icon name="bookmark-add" size={16} />
          收藏当前页
        </button>
        <button className="button button--quiet" type="button" onClick={onAddManual}>
          手动添加
        </button>
      </div>
    </div>
  )
}

function SearchEmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="empty-state empty-state--search">
      <span className="empty-state__mark" aria-hidden="true">
        <Icon name="search" size={22} />
      </span>
      <h3>没有找到匹配的网站</h3>
      <p>收藏名称或网址中没有包含“{query}”。</p>
      <div className="empty-state__actions">
        <button className="button button--quiet" type="button" onClick={onClear}>
          清除搜索
        </button>
      </div>
    </div>
  )
}

function BookmarkFormModal({
  mode,
  initial,
  groups,
  onClose,
  onSave,
  onRequestDelete,
}: {
  mode: 'create' | 'edit'
  initial: BookmarkDraft
  groups: Group[]
  onClose: () => void
  onSave: (draft: BookmarkDraft) => Promise<void>
  onRequestDelete?: () => void
}) {
  const [draft, setDraft] = useState<BookmarkDraft>(initial)
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setFormError(undefined)
    try {
      await onSave(draft)
      onClose()
    } catch (caught) {
      setFormError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={mode === 'create' ? '添加网站' : '编辑网站'} onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <div className="form__body">
          <label className="field">
            <span>网站名称</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="留空时使用域名"
              maxLength={80}
              autoFocus
            />
          </label>
          <label className="field">
            <span>网址</span>
            <input
              type="text"
              inputMode="url"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              placeholder="https://example.com"
              maxLength={2048}
              required
            />
          </label>
          <label className="field">
            <span>放入分组</span>
            <select
              value={draft.groupId}
              onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}
            >
              {groups.map((group) => (
                <option value={group.id} key={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          {formError && <p className="form__error">{formError}</p>}
        </div>
        <footer className="form__footer">
          {onRequestDelete ? (
            <button className="button button--danger" type="button" onClick={onRequestDelete}>
              <Icon name="trash" size={16} />
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="form__actions">
            <button className="button button--quiet" type="button" onClick={onClose}>
              取消
            </button>
            <button className="button button--ink" type="submit" disabled={saving}>
              {saving ? '保存中…' : mode === 'create' ? '加入卡组' : '保存修改'}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  )
}

function GroupFormModal({
  mode,
  initialName,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit'
  initialName: string
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setFormError(undefined)
    try {
      await onSave(name)
      onClose()
    } catch (caught) {
      setFormError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={mode === 'create' ? '新建分组' : '重命名分组'} onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <div className="form__body">
          <label className="field">
            <span>分组名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：工作、灵感、常用"
              maxLength={24}
              autoFocus
              required
            />
          </label>
          {formError && <p className="form__error">{formError}</p>}
        </div>
        <footer className="form__footer form__footer--end">
          <button className="button button--quiet" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--ink" type="submit" disabled={saving}>
            {saving ? '保存中…' : mode === 'create' ? '创建分组' : '保存修改'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function GroupManagerModal({
  groups,
  bookmarks,
  activeGroupId,
  onClose,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
}: {
  groups: Group[]
  bookmarks: Bookmark[]
  activeGroupId: string
  onClose: () => void
  onSelect: (groupId: string) => void
  onAdd: () => void
  onEdit: (group: Group) => void
  onDelete: (groupId: string) => Promise<void>
}) {
  const [formError, setFormError] = useState<string>()

  const deleteGroup = async (group: Group) => {
    setFormError(undefined)
    try {
      await onDelete(group.id)
    } catch (caught) {
      setFormError(errorMessage(caught))
    }
  }

  return (
    <Modal title="管理分组" onClose={onClose} size="wide">
      <div className="group-manager">
        <p className="group-manager__hint">空分组才能删除，避免误删其中的网站。</p>
        <div className="group-manager__list">
          {groups.map((group) => {
            const count = bookmarks.filter((bookmark) => bookmark.groupId === group.id).length
            const canDelete = groups.length > 1 && count === 0
            return (
              <div className="group-manager__row" key={group.id}>
                <button
                  className="group-manager__select"
                  type="button"
                  onClick={() => onSelect(group.id)}
                >
                  <span className={group.id === activeGroupId ? 'group-dot group-dot--active' : 'group-dot'} />
                  <strong>{group.name}</strong>
                  <small>{count} 个网站</small>
                </button>
                <div className="group-manager__actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => onEdit(group)}
                    aria-label={`重命名 ${group.name}`}
                    title="重命名"
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    className="icon-button icon-button--danger"
                    type="button"
                    disabled={!canDelete}
                    onClick={() => void deleteGroup(group)}
                    aria-label={`删除 ${group.name}`}
                    title={canDelete ? '删除空分组' : '分组非空时不能删除'}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {formError && <p className="form__error">{formError}</p>}
        <footer className="group-manager__footer">
          <button className="button button--quiet" type="button" onClick={onClose}>
            完成
          </button>
          <button className="button button--ink" type="button" onClick={onAdd}>
            <Icon name="add" size={16} />
            新建分组
          </button>
        </footer>
      </div>
    </Modal>
  )
}

function ConfirmDeleteModal({
  bookmark,
  onClose,
  onConfirm,
}: {
  bookmark: Bookmark
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string>()

  const confirm = async () => {
    setDeleting(true)
    setFormError(undefined)
    try {
      await onConfirm()
    } catch (caught) {
      setFormError(errorMessage(caught))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal title="删除收藏？" onClose={onClose}>
      <div className="confirm">
        <span className="confirm__mark" aria-hidden="true">
          <Icon name="trash" size={20} />
        </span>
        <p>
          将从 LinkDeck 删除 <strong>{bookmark.title}</strong>。
        </p>
        {formError && <p className="form__error">{formError}</p>}
        <footer className="form__footer form__footer--end">
          <button className="button button--quiet" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button button--danger-solid" type="button" onClick={() => void confirm()} disabled={deleting}>
            {deleting ? '删除中…' : '确认删除'}
          </button>
        </footer>
      </div>
    </Modal>
  )
}
