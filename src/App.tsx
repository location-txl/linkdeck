import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Favicon } from './components/Favicon'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { TagFilterBar } from './components/TagFilterBar'
import { TagInput } from './components/TagInput'
import { DataTransferModal } from './data-transfer/DataTransferModal'
import { getGistSyncStatus, requestGistSync, subscribeGistSyncStatus } from './gist-sync/client'
import type { GistSyncViewState } from './gist-sync/types'
import { getCurrentPageDraft, openBookmark, openManagerPage } from './lib/chrome-api'
import { bookmarkRepository } from './lib/bookmark-repository'
import { getHostname, UserFacingError } from './lib/bookmark-utils'
import { getTagClickMode, getTagFilter, setTagClickMode, setTagFilter as saveTagFilter } from './lib/preferences'
import type {
  Bookmark,
  BookmarkDraft,
  CollectionSnapshot,
  ImportMode,
  ImportSummary,
  Tag,
  TagClickMode,
  TagFilter,
} from './types'

type BookmarkModalState =
  | { mode: 'create'; initial: BookmarkDraft }
  | { mode: 'edit'; bookmark: Bookmark; initial: BookmarkDraft }

type TagFormState =
  | { mode: 'create' }
  | { mode: 'edit'; tag: Tag }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '出现未知错误，请稍后重试。'
}

function getBookmarkDraft(bookmark: Bookmark): BookmarkDraft {
  return {
    title: bookmark.title,
    url: bookmark.url,
    tagIds: bookmark.tagIds,
    newTagNames: [],
  }
}

function sanitizeFilter(filter: TagFilter, tags: Tag[]): TagFilter {
  if (filter.untaggedOnly) return { tagIds: [], untaggedOnly: true }
  const validIds = new Set(tags.map((tag) => tag.id))
  return { tagIds: filter.tagIds.filter((tagId) => validIds.has(tagId)), untaggedOnly: false }
}

export default function App({ view = 'popup' }: { view?: 'popup' | 'manager' }) {
  const [snapshot, setSnapshot] = useState<CollectionSnapshot | null>(null)
  const [tagFilter, setFilterState] = useState<TagFilter>({ tagIds: [], untaggedOnly: false })
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [bookmarkModal, setBookmarkModal] = useState<BookmarkModalState>()
  const [tagForm, setTagForm] = useState<TagFormState>()
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dataManagerOpen, setDataManagerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Bookmark>()
  const [deleteTagTarget, setDeleteTagTarget] = useState<Tag>()
  const [searchQuery, setSearchQuery] = useState('')
  const [tagClickMode, setTagClickModeState] = useState<TagClickMode>('modifier-multi')
  const [gistSyncState, setGistSyncState] = useState<GistSyncViewState>({ status: 'disconnected' })
  const searchInputRef = useRef<HTMLInputElement>(null)

  const applyTagFilter = useCallback((next: TagFilter) => {
    setFilterState(next)
    void saveTagFilter(next)
  }, [])

  const refresh = useCallback(async () => {
    const next = await bookmarkRepository.load()
    setSnapshot(next)
    setFilterState((current) => {
      const resolved = sanitizeFilter(current, next.meta.tags)
      if (JSON.stringify(resolved) !== JSON.stringify(current)) void saveTagFilter(resolved)
      return resolved
    })
    return next
  }, [])

  useEffect(() => {
    let alive = true
    const initialize = async () => {
      try {
        const [next, savedFilter, savedTagClickMode] = await Promise.all([bookmarkRepository.load(), getTagFilter(), getTagClickMode()])
        if (!alive) return
        const filter = sanitizeFilter(savedFilter, next.meta.tags)
        setSnapshot(next)
        setFilterState(filter)
        setTagClickModeState(savedTagClickMode)
        if (JSON.stringify(filter) !== JSON.stringify(savedFilter)) void saveTagFilter(filter)
      } catch (caught) {
        if (alive) setError(errorMessage(caught))
      }
    }
    void initialize()
    const unsubscribe = bookmarkRepository.subscribe(
      (next) => {
        if (!alive) return
        setSnapshot(next)
        setFilterState((current) => {
          const resolved = sanitizeFilter(current, next.meta.tags)
          if (JSON.stringify(resolved) !== JSON.stringify(current)) void saveTagFilter(resolved)
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
    let alive = true
    const updateState = (next: GistSyncViewState) => {
      if (alive) setGistSyncState(next)
    }
    void getGistSyncStatus().then(updateState)
    void requestGistSync({ type: 'gist-sync:sync-now' }).then((response) => updateState(response.state))
    const unsubscribe = subscribeGistSyncStatus(updateState)
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
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const runMutation = useCallback(async (operation: () => Promise<unknown>, successMessage: string) => {
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
  }, [refresh])

  const tagNames = useMemo(
    () => new Map(snapshot?.meta.tags.map((tag) => [tag.id, tag.name])),
    [snapshot],
  )
  const searchTerm = useMemo(() => searchQuery.trim().toLocaleLowerCase(), [searchQuery])
  const isSearching = searchTerm.length > 0
  const filteredBookmarks = useMemo(() => {
    if (!snapshot) return []
    return snapshot.bookmarks.filter((bookmark) => {
      if (tagFilter.untaggedOnly) return bookmark.tagIds.length === 0
      return tagFilter.tagIds.every((tagId) => bookmark.tagIds.includes(tagId))
    })
  }, [snapshot, tagFilter])
  const visibleBookmarks = useMemo(
    () => filteredBookmarks
      .filter((bookmark) => !isSearching ||
        bookmark.title.toLocaleLowerCase().includes(searchTerm) || bookmark.url.toLocaleLowerCase().includes(searchTerm))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)),
    [filteredBookmarks, isSearching, searchTerm],
  )

  const selectedFilterTags = useMemo(
    () => snapshot?.meta.tags.filter((tag) => tagFilter.tagIds.includes(tag.id)) ?? [],
    [snapshot, tagFilter.tagIds],
  )
  const listTitle = tagFilter.untaggedOnly
    ? '无标签'
    : selectedFilterTags.length === 0
      ? '全部链接'
      : selectedFilterTags.map((tag) => tag.name).join(' + ')

  const toggleTag = (tagId: string, multiSelect: boolean) => {
    if (tagClickMode === 'modifier-multi' && !multiSelect) {
      if (!tagFilter.untaggedOnly && tagFilter.tagIds.length === 1 && tagFilter.tagIds[0] === tagId) return
      applyTagFilter({ tagIds: [tagId], untaggedOnly: false })
      return
    }

    const tagIds = tagFilter.untaggedOnly ? [tagId] :
      tagFilter.tagIds.includes(tagId)
        ? tagFilter.tagIds.filter((id) => id !== tagId)
        : [...tagFilter.tagIds, tagId]
    applyTagFilter({ tagIds, untaggedOnly: false })
  }

  const selectTagClickMode = (mode: TagClickMode) => {
    setTagClickModeState(mode)
    void setTagClickMode(mode)
  }

  const defaultDraft = (): BookmarkDraft => ({
    title: '',
    url: '',
    tagIds: tagFilter.untaggedOnly ? [] : tagFilter.tagIds,
    newTagNames: [],
  })

  const openManualForm = () => setBookmarkModal({ mode: 'create', initial: defaultDraft() })
  const openCurrentPageForm = async () => {
    setError(undefined)
    try {
      const draft = await getCurrentPageDraft()
      setBookmarkModal({ mode: 'create', initial: { ...draft, tagIds: tagFilter.untaggedOnly ? [] : tagFilter.tagIds } })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const saveBookmark = async (draft: BookmarkDraft) => {
    if (bookmarkModal?.mode === 'edit') {
      await runMutation(() => bookmarkRepository.updateBookmark(bookmarkModal.bookmark.id, draft), '网站已更新。')
      return
    }
    const result = await bookmarkRepository.createBookmark(draft)
    await refresh()
    setNotice(result.created ? '已添加到 LinkDeck。' : result.tagsMerged ? '该网站已存在，已合并标签。' : '该网站已收藏。')
  }

  const saveTag = async (name: string) => {
    if (tagForm?.mode === 'edit') {
      await runMutation(() => bookmarkRepository.renameTag(tagForm.tag.id, name), '标签名称已更新。')
      return
    }
    const tag = await bookmarkRepository.createTag(name)
    await refresh()
    applyTagFilter({ tagIds: [...tagFilter.tagIds, tag.id], untaggedOnly: false })
    setNotice('已创建新标签。')
  }

  const importData = async (imported: CollectionSnapshot, mode: ImportMode) => {
    setError(undefined)
    try {
      const summary = await bookmarkRepository.importSnapshot(imported, mode)
      await refresh()
      if (mode === 'replace') applyTagFilter({ tagIds: [], untaggedOnly: false })
      setDataManagerOpen(false)
      setNotice(importNotice(summary))
    } catch (caught) {
      throw new UserFacingError(errorMessage(caught))
    }
  }

  if (!snapshot) {
    return (
      <main className={`app-shell app-shell--loading ${view === 'manager' ? 'app-shell--manager' : ''}`}>
        <div className="loading-card"><span className="loading-card__mark"><Icon name="deck" size={22} /></span><span>正在整理你的链接…</span></div>
      </main>
    )
  }

  const untaggedCount = snapshot.bookmarks.filter((bookmark) => bookmark.tagIds.length === 0).length
  const tagCounts = new Map(snapshot.meta.tags.map((tag) => [
    tag.id,
    snapshot.bookmarks.filter((bookmark) => bookmark.tagIds.includes(tag.id)).length,
  ]))
  return (
    <main className={`app-shell ${view === 'manager' ? 'app-shell--manager' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><Icon name="deck" size={20} /></span>
          <div><span className="brand__eyebrow">{view === 'manager' ? 'LINK MANAGER' : 'PERSONAL LINKS'}</span><h1>LinkDeck</h1></div>
        </div>
        <div className="topbar__actions">
          <span className="sync-state" title={gistSyncTitle(gistSyncState)}><Icon name="cloud" size={15} /><span>{gistSyncLabel(gistSyncState)}</span></span>
          {view === 'popup' && <button className="icon-button" type="button" onClick={() => void openManagerPage()} aria-label="全屏管理" title="在新标签页中管理"><Icon name="expand" /></button>}
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="设置" title="设置"><Icon name="settings" /></button>
          <button className="icon-button" type="button" onClick={() => setDataManagerOpen(true)} aria-label="数据管理" title="数据管理"><Icon name="more" /></button>
          <button className="icon-button" type="button" onClick={() => setTagManagerOpen(true)} aria-label="管理标签" title="管理标签"><Icon name="layers" /></button>
          <button className="icon-button icon-button--accent" type="button" onClick={openManualForm} aria-label="手动添加网站" title="手动添加网站"><Icon name="add" /></button>
        </div>
      </header>

      {(error || notice) && (
        <div className={error ? 'message message--error' : 'message message--notice'} role="status">
          <Icon name={error ? 'warning' : 'check'} size={15} /><span>{error ?? notice}</span>
          {error && <button className="message__close" type="button" onClick={() => setError(undefined)} aria-label="关闭提示"><Icon name="close" size={14} /></button>}
        </div>
      )}

      <section className="collection-bar" aria-label="链接导航">
        <div className="collection-bar__heading"><span>链接收藏</span><b>{snapshot.bookmarks.length}</b></div>
        {view === 'popup' && <button className="current-page-button" type="button" onClick={() => void openCurrentPageForm()}><Icon name="bookmark-add" size={16} />收藏当前页</button>}
      </section>

      <TagFilterBar
        tags={snapshot.meta.tags}
        tagCounts={tagCounts}
        totalCount={snapshot.bookmarks.length}
        untaggedCount={untaggedCount}
        filter={tagFilter}
        onSelectAll={() => applyTagFilter({ tagIds: [], untaggedOnly: false })}
        onToggleTag={toggleTag}
        onToggleUntagged={() => applyTagFilter({ tagIds: [], untaggedOnly: !tagFilter.untaggedOnly })}
        onAdd={() => setTagForm({ mode: 'create' })}
      />

      <div className="search-field" role="search">
        <Icon className="search-field__icon" name="search" size={16} />
        <input ref={searchInputRef} type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索名称或网址" aria-label="搜索收藏" aria-keyshortcuts="Meta+F Control+F" title="按 ⌘F 搜索" />
        {searchQuery && <button className="search-field__clear" type="button" onClick={() => setSearchQuery('')} aria-label="清除搜索" title="清除搜索"><Icon name="close" size={14} /></button>}
      </div>

      <section className="bookmarks">
        <div className="bookmarks__heading">
          <div><span className="bookmarks__label"><Icon name={isSearching ? 'search' : 'folder'} size={14} />{isSearching ? '筛选搜索' : '当前标签'}</span><h2>{isSearching ? `${visibleBookmarks.length} 条结果` : listTitle}</h2></div>
          <button className="text-button" type="button" onClick={() => setTagManagerOpen(true)}>管理标签<Icon name="chevron-right" size={15} /></button>
        </div>
        {visibleBookmarks.length > 0 ? (
          <div className="bookmark-list">
            {visibleBookmarks.map((bookmark) => (
              <article className="bookmark-row" key={bookmark.id}>
                <button className="bookmark-row__open" type="button" aria-label={`打开 ${bookmark.title}`} onClick={(event) => void openBookmark(bookmark.url, event.metaKey || event.ctrlKey)} title={`${eventHint()}打开 ${bookmark.title}`}>
                  <Favicon url={bookmark.url} />
                  <span className="bookmark-row__copy"><strong>{bookmark.title}</strong><small>{getHostname(bookmark.url)}</small><BookmarkTags bookmark={bookmark} tagNames={tagNames} /></span>
                  <Icon name="arrow-up-right" size={16} />
                </button>
                <button className="bookmark-row__edit icon-button" type="button" aria-label={`编辑 ${bookmark.title}`} title="编辑网站" onClick={() => setBookmarkModal({ mode: 'edit', bookmark, initial: getBookmarkDraft(bookmark) })}><Icon name="edit" size={16} /></button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState searching={isSearching} query={searchQuery.trim()} onClear={() => setSearchQuery('')} onAddCurrent={view === 'popup' ? () => void openCurrentPageForm() : undefined} onAddManual={openManualForm} />
        )}
      </section>

      <footer className="privacy-note"><Icon name="globe" size={14} /><span>网站图标会从 favicon.im 获取</span></footer>

      {bookmarkModal && <BookmarkFormModal key={bookmarkModal.mode === 'edit' ? bookmarkModal.bookmark.id : 'create'} mode={bookmarkModal.mode} initial={bookmarkModal.initial} tags={snapshot.meta.tags} onClose={() => setBookmarkModal(undefined)} onSave={saveBookmark} onRequestDelete={bookmarkModal.mode === 'edit' ? () => { setDeleteTarget(bookmarkModal.bookmark); setBookmarkModal(undefined) } : undefined} />}
      {settingsOpen && <SettingsModal mode={tagClickMode} onSelectMode={selectTagClickMode} onClose={() => setSettingsOpen(false)} />}
      {dataManagerOpen && <DataTransferModal snapshot={snapshot} onClose={() => setDataManagerOpen(false)} onExported={(filename) => { setDataManagerOpen(false); setNotice(`已导出 ${filename}。`) }} onImport={importData} onGistSyncStateChange={setGistSyncState} />}
      {tagManagerOpen && <TagManagerModal tags={snapshot.meta.tags} bookmarks={snapshot.bookmarks} onClose={() => setTagManagerOpen(false)} onAdd={() => { setTagManagerOpen(false); setTagForm({ mode: 'create' }) }} onEdit={(tag) => { setTagManagerOpen(false); setTagForm({ mode: 'edit', tag }) }} onDelete={(tag) => { setTagManagerOpen(false); setDeleteTagTarget(tag) }} onTogglePin={(tag) => runMutation(() => bookmarkRepository.setTagPinned(tag.id, !tag.pinned), tag.pinned ? '已取消置顶标签。' : '标签已置顶。')} />}
      {tagForm && <TagFormModal key={tagForm.mode === 'edit' ? tagForm.tag.id : 'create'} mode={tagForm.mode} initialName={tagForm.mode === 'edit' ? tagForm.tag.name : ''} onClose={() => setTagForm(undefined)} onSave={saveTag} />}
      {deleteTarget && <ConfirmDeleteModal bookmark={deleteTarget} onClose={() => setDeleteTarget(undefined)} onConfirm={async () => { await runMutation(() => bookmarkRepository.deleteBookmark(deleteTarget.id), '网站已删除。'); setDeleteTarget(undefined) }} />}
      {deleteTagTarget && <ConfirmDeleteTagModal tag={deleteTagTarget} linkCount={snapshot.bookmarks.filter((bookmark) => bookmark.tagIds.includes(deleteTagTarget.id)).length} onClose={() => setDeleteTagTarget(undefined)} onConfirm={async () => { await runMutation(() => bookmarkRepository.deleteTag(deleteTagTarget.id), '标签已删除，链接已保留。'); setDeleteTagTarget(undefined) }} />}
    </main>
  )
}

function BookmarkTags({ bookmark, tagNames }: { bookmark: Bookmark; tagNames: Map<string, string> }) {
  const names = bookmark.tagIds.map((tagId) => tagNames.get(tagId)).filter((name): name is string => Boolean(name))
  if (names.length === 0) return null
  const shown = names.slice(0, 3)
  return <span className="bookmark-row__tags">{shown.map((name) => <span className="bookmark-row__tag" key={name}>{name}</span>)}{names.length > shown.length && <span className="bookmark-row__tag">+{names.length - shown.length}</span>}</span>
}

function eventHint(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘ 点击可在后台' : 'Ctrl 点击可在后台'
}

function importNotice(summary: ImportSummary): string {
  const message = `已导入 ${summary.tagsAdded} 个标签和 ${summary.bookmarksAdded} 个网站。`
  return summary.bookmarksMerged > 0 ? `${message} 合并 ${summary.bookmarksMerged} 个已有网站。` : message
}

function gistSyncLabel(state: GistSyncViewState): string {
  if (state.status === 'synced') return 'Gist 已同步'
  if (state.status === 'syncing') return '同步中'
  if (state.status === 'conflict') return '同步冲突'
  if (state.status === 'error') return '同步失败'
  return '已保存'
}

function gistSyncTitle(state: GistSyncViewState): string {
  return state.status === 'disconnected' ? '已保存到浏览器同步存储' : state.error ?? gistSyncLabel(state)
}

function EmptyState({ searching, query, onClear, onAddCurrent, onAddManual }: { searching: boolean; query: string; onClear: () => void; onAddCurrent?: () => void; onAddManual: () => void }) {
  if (searching) {
    return <div className="empty-state empty-state--search"><span className="empty-state__mark"><Icon name="search" size={23} /></span><h3>没有找到“{query}”</h3><p>试试其他关键词，或调整标签筛选。</p><button className="button button--quiet" type="button" onClick={onClear}>清除搜索</button></div>
  }
  return <div className="empty-state"><span className="empty-state__mark"><Icon name="link" size={23} /></span><h3>这里还没有链接</h3><p>添加常用网站，再用标签把它们灵活整理好。</p><div className="empty-state__actions">{onAddCurrent && <button className="button button--ink" type="button" onClick={onAddCurrent}><Icon name="bookmark-add" size={16} />收藏当前页</button>}<button className="button button--quiet" type="button" onClick={onAddManual}><Icon name="add" size={16} />手动添加</button></div></div>
}

function SettingsModal({ mode, onSelectMode, onClose }: { mode: TagClickMode; onSelectMode: (mode: TagClickMode) => void; onClose: () => void }) {
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '开发版'
  return (
    <Modal title="设置" onClose={onClose}>
      <div className="settings">
        <fieldset className="settings__section">
          <legend>标签点击方式</legend>
          <label className="settings__option">
            <input type="radio" name="tag-click-mode" checked={mode === 'modifier-multi'} onChange={() => onSelectMode('modifier-multi')} />
            <span><strong>切换标签</strong><small>点击切换单个标签；按 Command 或 Ctrl 点击可多选。</small></span>
          </label>
          <label className="settings__option">
            <input type="radio" name="tag-click-mode" checked={mode === 'direct-multi'} onChange={() => onSelectMode('direct-multi')} />
            <span><strong>直接多选</strong><small>点击即可选中或取消标签，可连续多选。</small></span>
          </label>
        </fieldset>
        <section className="settings__section settings__about" aria-labelledby="settings-about-title">
          <h3 id="settings-about-title">关于</h3>
          <div><strong>LinkDeck</strong><span>v{version}</span></div>
        </section>
        <footer className="form__footer form__footer--end"><button className="button button--quiet" type="button" onClick={onClose}>完成</button></footer>
      </div>
    </Modal>
  )
}

function BookmarkFormModal({ mode, initial, tags, onClose, onSave, onRequestDelete }: { mode: 'create' | 'edit'; initial: BookmarkDraft; tags: Tag[]; onClose: () => void; onSave: (draft: BookmarkDraft) => Promise<void>; onRequestDelete?: () => void }) {
  const [draft, setDraft] = useState<BookmarkDraft>(initial)
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setFormError(undefined)
    try { await onSave(draft); onClose() } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }
  return <Modal title={mode === 'create' ? '添加网站' : '编辑网站'} onClose={onClose}><form className="form" onSubmit={(event) => void submit(event)}><div className="form__body"><label className="field"><span>网站名称</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="留空时使用域名" maxLength={80} autoFocus /></label><label className="field"><span>网址</span><input type="text" inputMode="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com" maxLength={2048} required /></label><div className="field"><span>标签</span><TagInput tags={tags} value={draft} onChange={(tagsValue) => setDraft({ ...draft, ...tagsValue })} /></div>{formError && <p className="form__error">{formError}</p>}</div><footer className="form__footer">{onRequestDelete ? <button className="button button--danger" type="button" onClick={onRequestDelete}><Icon name="trash" size={16} />删除</button> : <span />}{<div className="form__actions"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--ink" type="submit" disabled={saving}>{saving ? '保存中…' : mode === 'create' ? '添加网站' : '保存修改'}</button></div>}</footer></form></Modal>
}

function TagFormModal({ mode, initialName, onClose, onSave }: { mode: 'create' | 'edit'; initialName: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initialName)
  const [formError, setFormError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setFormError(undefined)
    try { await onSave(name); onClose() } catch (caught) { setFormError(errorMessage(caught)) } finally { setSaving(false) }
  }
  return <Modal title={mode === 'create' ? '新建标签' : '重命名标签'} onClose={onClose}><form className="form" onSubmit={(event) => void submit(event)}><div className="form__body"><label className="field"><span>标签名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：工作、灵感、常用" maxLength={24} autoFocus required /></label>{formError && <p className="form__error">{formError}</p>}</div><footer className="form__footer form__footer--end"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--ink" type="submit" disabled={saving}>{saving ? '保存中…' : mode === 'create' ? '创建标签' : '保存修改'}</button></footer></form></Modal>
}

function TagManagerModal({ tags, bookmarks, onClose, onAdd, onEdit, onDelete, onTogglePin }: { tags: Tag[]; bookmarks: Bookmark[]; onClose: () => void; onAdd: () => void; onEdit: (tag: Tag) => void; onDelete: (tag: Tag) => void; onTogglePin: (tag: Tag) => Promise<void> }) {
  const [pendingTagId, setPendingTagId] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const tagMutationPending = pendingTagId !== undefined
  const orderedTags = [...tags].sort((left, right) => Number(right.pinned) - Number(left.pinned))
  const togglePin = async (tag: Tag) => {
    setPendingTagId(tag.id)
    setFormError(undefined)
    try { await onTogglePin(tag) } catch (caught) { setFormError(errorMessage(caught)) } finally { setPendingTagId(undefined) }
  }
  return <Modal title="管理标签" onClose={onClose} size="wide"><div className="tag-manager"><p className="tag-manager__hint">置顶标签会优先显示在筛选栏中；删除标签只会移除链接上的标签，不会删除网站。</p><div className="tag-manager__list">{orderedTags.map((tag) => <div className="tag-manager__row" key={tag.id}><div className="tag-manager__copy"><span className="tag-dot" /><strong>{tag.name}</strong><small>{bookmarks.filter((bookmark) => bookmark.tagIds.includes(tag.id)).length} 个网站</small></div><div className="tag-manager__actions"><button className={`icon-button ${tag.pinned ? 'icon-button--active' : ''}`} type="button" disabled={tagMutationPending} onClick={() => void togglePin(tag)} aria-label={`${tag.pinned ? '取消置顶' : '置顶'} ${tag.name}`} title={tag.pinned ? '取消置顶标签' : '置顶标签'}><Icon name="pin" size={16} /></button><button className="icon-button" type="button" disabled={tagMutationPending} onClick={() => onEdit(tag)} aria-label={`重命名 ${tag.name}`} title="重命名"><Icon name="edit" size={16} /></button><button className="icon-button icon-button--danger" type="button" disabled={tagMutationPending} onClick={() => onDelete(tag)} aria-label={`删除 ${tag.name}`} title="删除标签"><Icon name="trash" size={16} /></button></div></div>)}</div>{formError && <p className="form__error">{formError}</p>}<footer className="tag-manager__footer"><button className="button button--quiet" type="button" onClick={onClose}>完成</button><button className="button button--ink" type="button" disabled={tagMutationPending} onClick={onAdd}><Icon name="add" size={16} />新建标签</button></footer></div></Modal>
}

function ConfirmDeleteModal({ bookmark, onClose, onConfirm }: { bookmark: Bookmark; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <ConfirmModal title="删除网站" mark="trash" onClose={onClose} onConfirm={onConfirm} confirmLabel="删除网站"><p>确定删除 <strong>{bookmark.title}</strong> 吗？此操作无法撤销。</p></ConfirmModal>
}

function ConfirmDeleteTagModal({ tag, linkCount, onClose, onConfirm }: { tag: Tag; linkCount: number; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <ConfirmModal title="删除标签" mark="warning" onClose={onClose} onConfirm={onConfirm} confirmLabel="删除标签"><p>确定删除 <strong>{tag.name}</strong> 吗？它会从 {linkCount} 个网站移除，但网站会被保留。</p></ConfirmModal>
}

function ConfirmModal({ title, mark, children, onClose, onConfirm, confirmLabel }: { title: string; mark: 'trash' | 'warning'; children: React.ReactNode; onClose: () => void; onConfirm: () => Promise<void>; confirmLabel: string }) {
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()
  const confirm = async () => { setBusy(true); setFormError(undefined); try { await onConfirm() } catch (caught) { setFormError(errorMessage(caught)) } finally { setBusy(false) } }
  return <Modal title={title} onClose={onClose}><div className="confirm"><span className="confirm__mark"><Icon name={mark} size={18} /></span>{children}{formError && <p className="form__error">{formError}</p>}<footer className="form__footer"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--danger-solid" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? '处理中…' : confirmLabel}</button></footer></div></Modal>
}
