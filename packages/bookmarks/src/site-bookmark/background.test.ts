import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSyncStore, installChromeMock, scriptingRegisterContentScripts, scriptingUnregisterContentScripts, setTabs, tabsSendMessage } from '@linkdeck/test-utils'
import { bookmarkRepository } from '../bookmark-repository'
import { handleSiteBookmarkMessage, syncSiteBookmarkScripts } from './background'
import { SITE_BOOKMARK_SAVE, SITE_BOOKMARK_STOP } from './messages'
import { siteOrigins } from './rules'
import { SITE_BOOKMARK_KEY, type SiteRule } from './types'

const rule: SiteRule = {
  id: 'rule-1', domain: 'github.com', name: 'GitHub', enabled: true,
  triggerSelector: 'button[data-testid="star"]',
  url: { source: { kind: 'pageUrl' } },
  title: { source: { kind: 'pageTitle' } },
  tagName: 'GitHub', createdAt: 1, updatedAt: 1,
}
const sender = { tab: { id: 1 } as chrome.tabs.Tab, frameId: 0, url: 'https://github.com/owner/repo' }
const message = { type: SITE_BOOKMARK_SAVE, ruleId: 'rule-1', url: 'https://github.com/owner/repo', title: ' owner/repo: 工具库 ' }

beforeEach(async () => {
  installChromeMock()
  setTabs([{ id: 1, url: 'https://github.com/owner/repo' }])
  await chrome.permissions.request({ origins: siteOrigins('github.com') })
  await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: true, rules: [rule] } })
})

describe('站点收藏后台', () => {
  it('saves with the rule tag and dedupes repeated clicks', async () => {
    expect(await handleSiteBookmarkMessage(message, sender)).toMatchObject({ ok: true, created: true })
    expect(await handleSiteBookmarkMessage(message, sender)).toMatchObject({ ok: true, created: false, tagsMerged: false })
    const snapshot = await bookmarkRepository.load()
    expect(snapshot.meta.tags[0].name).toBe('GitHub')
    expect(snapshot.bookmarks).toHaveLength(1)
    expect(snapshot.bookmarks[0]).toMatchObject({ url: 'https://github.com/owner/repo', title: 'owner/repo: 工具库', tagIds: [snapshot.meta.tags[0].id] })
  })

  it('rejects forged sources, disabled rules, missing grants and unsafe urls', async () => {
    for (const source of [{ ...sender, url: 'https://evil.test/x' }, { ...sender, frameId: 1 }, { url: 'about:blank' }]) {
      expect(await handleSiteBookmarkMessage(message, source as typeof sender)).toMatchObject({ ok: false })
    }
    for (const payload of [
      { ...message, ruleId: 'missing' },
      { ...message, url: 'javascript:alert(1)' },
      { type: 'linkdeck:site-bookmark:other' },
    ]) {
      expect(await handleSiteBookmarkMessage(payload, sender)).toMatchObject({ ok: false })
    }
    await chrome.permissions.remove({ origins: siteOrigins('github.com') })
    expect(await handleSiteBookmarkMessage(message, sender)).toMatchObject({ ok: false })
    expect(getSyncStore()).toEqual({})
  })

  it('reports repository failures without stopping the page', async () => {
    const spy = vi.spyOn(bookmarkRepository, 'createBookmark').mockRejectedValueOnce(new Error('存储已满'))
    expect(await handleSiteBookmarkMessage(message, sender)).toEqual({ ok: false, error: '存储已满' })
    spy.mockRestore()
  })

  it('registers granted origins, skips no-op syncs and stops pages after revocation', async () => {
    await syncSiteBookmarkScripts()
    expect(scriptingRegisterContentScripts).toHaveBeenCalledWith([expect.objectContaining({
      id: 'linkdeck-site-bookmark-v1', matches: ['http://*.github.com/*', 'https://*.github.com/*'], world: 'ISOLATED',
    })])
    await syncSiteBookmarkScripts()
    expect(scriptingRegisterContentScripts).toHaveBeenCalledTimes(1)
    await chrome.permissions.remove({ origins: siteOrigins('github.com') })
    await syncSiteBookmarkScripts()
    expect(scriptingUnregisterContentScripts).toHaveBeenCalledWith({ ids: ['linkdeck-site-bookmark-v1'] })
    expect(tabsSendMessage).toHaveBeenCalledWith(1, { type: SITE_BOOKMARK_STOP })
  })

  it('stops injecting pages whose rules were disabled while keeping registration in sync', async () => {
    await chrome.storage.local.set({ [SITE_BOOKMARK_KEY]: { enabled: false, rules: [rule] } })
    await syncSiteBookmarkScripts()
    expect(scriptingRegisterContentScripts).not.toHaveBeenCalled()
    expect(tabsSendMessage).toHaveBeenCalledWith(1, { type: SITE_BOOKMARK_STOP })
  })
})
