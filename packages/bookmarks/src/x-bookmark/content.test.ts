import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock, runtimeOnMessageListeners, runtimeSendMessage } from '@linkdeck/test-utils'
import { installXBookmark, readPost } from './content'
import { X_BOOKMARK_SAVE, X_BOOKMARK_STATE, X_BOOKMARK_STOP } from './messages'

let cleanup: (() => void) | undefined
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
const fixture = (id = '123', state = 'bookmark') => `<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/author">作者</a></div>
  <a role="link" href="/author/status/${id}?s=20"><time>今天</time></a>
  <div data-testid="tweetText">正文</div>
  <div role="link"><div data-testid="User-Name"><a>引用作者</a></div><a role="link" href="/quote/status/456"><time>昨天</time></a><div data-testid="tweetText">引用正文</div><button data-testid="removeBookmark"></button></div>
  <div role="group"><button data-testid="${state}">书签</button></div>
</article>`
const action = () => document.querySelector<HTMLButtonElement>('[role="group"] button')!

beforeEach(() => {
  installChromeMock()
  document.body.innerHTML = fixture()
  runtimeSendMessage.mockResolvedValue({ ok: true, created: true })
})
const scope = globalThis as typeof globalThis & { linkdeckXBookmarkCleanup?: () => void }
const inject = async () => {
  vi.stubGlobal('location', { origin: 'https://x.com' })
  vi.resetModules()
  await import('./content')
  await flush()
}
const stop = () => {
  for (const listener of runtimeOnMessageListeners) listener({ type: X_BOOKMARK_STOP }, {}, () => undefined)
}
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  scope.linkdeckXBookmarkCleanup?.()
  delete scope.linkdeckXBookmarkCleanup
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('X 书签联动', () => {
  it('extracts only the outer post and strips tracking parameters', () => {
    const article = document.querySelector('article')!
    article.prepend(article.querySelector('[role="link"]:not(a)')!)
    expect(readPost(article)).toEqual({ url: 'https://x.com/author/status/123', title: '作者：正文' })
  })
  it('uses a post title for media-only posts instead of quoted text', () => {
    document.querySelector('article > [data-testid="tweetText"]')!.remove()
    expect(readPost(document.querySelector('article')!)?.title).toBe('作者 的 X 帖子 123')
  })
  it('waits for a saved state after an explicit click and saves only once', async () => {
    cleanup = installXBookmark()
    action().click()
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: X_BOOKMARK_SAVE, url: 'https://x.com/author/status/123', title: '作者：正文' })
    document.body.append(document.createElement('div'))
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="status"]')?.textContent).toContain('已收藏到 LinkDeck')
  })
  it('does not import existing bookmarks or delete when unbookmarking', async () => {
    document.body.innerHTML = fixture('123', 'removeBookmark')
    cleanup = installXBookmark()
    action().click()
    action().dataset.testid = 'bookmark'
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
  })
  it('does not save if X rolls back in the same update or recycles the article', async () => {
    cleanup = installXBookmark()
    action().click()
    action().dataset.testid = 'removeBookmark'
    action().dataset.testid = 'bookmark'
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
    document.querySelector('a[href*="/author/status/"]')!.setAttribute('href', '/author/status/999')
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
  })
  it('shows failed storage and allows retry without toggling the X bookmark', async () => {
    runtimeSendMessage.mockResolvedValueOnce({ ok: false, error: '存储已满' })
    cleanup = installXBookmark()
    action().click()
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('存储已满')
    document.querySelector<HTMLButtonElement>('[role="status"] button')!.click()
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(2)
    expect(action().dataset.testid).toBe('removeBookmark')
  })
  it('cleans up observers and click handlers when stopped', async () => {
    cleanup = installXBookmark()
    action().click()
    cleanup()
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(runtimeSendMessage).not.toHaveBeenCalled()
  })
})

describe('X 书签脚本初始化', () => {
  it('does not restart from a stale enabled response after a stop', async () => {
    let resolveState!: (response: { ok: boolean; enabled: boolean }) => void
    runtimeSendMessage.mockImplementationOnce(() => new Promise((resolve) => { resolveState = resolve }))
    await inject()
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith({ type: X_BOOKMARK_STATE })
    await inject()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    stop()
    resolveState({ ok: true, enabled: true })
    await flush()
    action().click()
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    expect(runtimeOnMessageListeners.size).toBe(0)
    expect(scope.linkdeckXBookmarkCleanup).toBeUndefined()
    runtimeSendMessage.mockResolvedValueOnce({ ok: true, enabled: true })
    await inject()
    action().dataset.testid = 'bookmark'
    action().click()
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(runtimeSendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      X_BOOKMARK_STATE, X_BOOKMARK_STATE, X_BOOKMARK_SAVE,
    ])
  })

  it('preserves in-flight saves and retry notices across repeated injections', async () => {
    runtimeSendMessage.mockResolvedValueOnce({ ok: true, enabled: true })
    await inject()
    let resolveSave!: (response: { ok: boolean; error: string }) => void
    runtimeSendMessage.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    action().click()
    action().dataset.testid = 'removeBookmark'
    await flush()
    await inject()
    resolveSave({ ok: false, error: '存储已满' })
    await flush()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('存储已满')
    await inject()
    document.querySelector<HTMLButtonElement>('[role="status"] button')!.click()
    await flush()
    expect(runtimeSendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      X_BOOKMARK_STATE, X_BOOKMARK_SAVE, X_BOOKMARK_SAVE,
    ])
    stop()
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(runtimeOnMessageListeners.size).toBe(0)
    expect(scope.linkdeckXBookmarkCleanup).toBeUndefined()
  })

  it.each(['disabled', 'rejected'])('allows a new initialization after a %s state request', async (state) => {
    if (state === 'disabled') runtimeSendMessage.mockResolvedValueOnce({ ok: true, enabled: false })
    else runtimeSendMessage.mockRejectedValueOnce(new Error('disconnected'))
    await inject()
    expect(runtimeOnMessageListeners.size).toBe(0)
    expect(scope.linkdeckXBookmarkCleanup).toBeUndefined()
    runtimeSendMessage.mockResolvedValueOnce({ ok: true, enabled: true })
    await inject()
    action().click()
    action().dataset.testid = 'removeBookmark'
    await flush()
    expect(runtimeSendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      X_BOOKMARK_STATE, X_BOOKMARK_STATE, X_BOOKMARK_SAVE,
    ])
  })
})
