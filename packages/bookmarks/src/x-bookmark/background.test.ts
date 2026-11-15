import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock, setTabs, scriptingRegisterContentScripts, scriptingUnregisterContentScripts, tabsSendMessage } from '@linkdeck/test-utils'
import { bookmarkRepository } from '../bookmark-repository'
import { handleXBookmarkMessage, syncXBookmarkScripts } from './background'
import { X_ORIGIN, X_BOOKMARK_KEY, X_BOOKMARK_SAVE, X_BOOKMARK_STATE, X_BOOKMARK_REFRESH, X_BOOKMARK_STOP } from './messages'

const sender = { tab: { id: 1 } as chrome.tabs.Tab, frameId: 0, url: 'https://x.com/home' }
const message = { type: X_BOOKMARK_SAVE, url: 'https://x.com/author/status/123?s=20', title: '作者：正文' }

beforeEach(async () => {
  installChromeMock()
  setTabs([{ id: 1, url: 'https://x.com/home' }])
  await chrome.permissions.request({ origins: [X_ORIGIN] })
  await chrome.storage.local.set({ [X_BOOKMARK_KEY]: true })
})

describe('X 收藏后台', () => {
  it('saves a canonical post and reuses the X tag on repeated saves', async () => {
    expect(await handleXBookmarkMessage(message, sender)).toMatchObject({ ok: true, created: true })
    expect(await handleXBookmarkMessage(message, sender)).toMatchObject({ ok: true, created: false, tagsMerged: false })
    const snapshot = await bookmarkRepository.load()
    expect(snapshot.meta.tags).toHaveLength(1)
    expect(snapshot.meta.tags[0].name).toBe('X')
    expect(snapshot.bookmarks).toHaveLength(1)
    expect(snapshot.bookmarks[0]).toMatchObject({ url: 'https://x.com/author/status/123', tagIds: [snapshot.meta.tags[0].id] })
  })

  it('adds X to an existing bookmark without overwriting its title or other tags', async () => {
    await bookmarkRepository.createBookmark({ title: '自定义标题', url: 'https://x.com/author/status/123', tagIds: [], newTagNames: ['工作'] })
    expect(await handleXBookmarkMessage(message, sender)).toMatchObject({ ok: true, created: false, tagsMerged: true })
    const snapshot = await bookmarkRepository.load()
    expect(snapshot.bookmarks[0].title).toBe('自定义标题')
    expect(snapshot.bookmarks[0].tagIds).toHaveLength(2)
  })

  it('rejects invalid sources, subframes, non-post URLs and disabled access', async () => {
    for (const source of [{ ...sender, url: 'https://x.com.evil.test/' }, { ...sender, frameId: 1 }, {}]) {
      expect(await handleXBookmarkMessage(message, source)).toMatchObject({ ok: false })
    }
    for (const url of ['https://x.com/home', 'https://evil.test/a/status/123', 'https://x.com/a/status/123/photo/1']) {
      expect(await handleXBookmarkMessage({ ...message, url }, sender)).toMatchObject({ ok: false })
    }
    expect(await handleXBookmarkMessage({ type: X_BOOKMARK_REFRESH }, sender)).toMatchObject({ ok: false })
    await chrome.permissions.remove({ origins: [X_ORIGIN] })
    expect(await handleXBookmarkMessage(message, sender)).toMatchObject({ ok: false })
    expect(await handleXBookmarkMessage({ type: X_BOOKMARK_STATE }, sender)).toEqual({ ok: true, enabled: false })
    expect((await bookmarkRepository.load()).bookmarks).toHaveLength(0)
  })

  it('returns storage failures without reporting success', async () => {
    const spy = vi.spyOn(bookmarkRepository, 'createBookmark').mockRejectedValueOnce(new Error('存储已满'))
    expect(await handleXBookmarkMessage(message, sender)).toEqual({ ok: false, error: '存储已满' })
    spy.mockRestore()
  })

  it('registers only X and stops existing pages when permission is revoked', async () => {
    await syncXBookmarkScripts()
    expect(scriptingRegisterContentScripts).toHaveBeenCalledWith([expect.objectContaining({ matches: [X_ORIGIN], world: 'ISOLATED' })])
    await syncXBookmarkScripts()
    expect(scriptingRegisterContentScripts).toHaveBeenCalledTimes(1)
    await chrome.permissions.remove({ origins: [X_ORIGIN] })
    await syncXBookmarkScripts()
    expect(scriptingUnregisterContentScripts).toHaveBeenCalledWith({ ids: ['linkdeck-x-bookmark-v1'] })
    expect(tabsSendMessage).toHaveBeenCalledWith(1, { type: X_BOOKMARK_STOP })
  })
})
