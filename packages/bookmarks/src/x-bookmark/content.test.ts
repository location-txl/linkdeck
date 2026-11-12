import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installChromeMock, runtimeSendMessage } from '@linkdeck/test-utils'
import { installXBookmark, readPost } from './content'
import { X_BOOKMARK_SAVE } from './messages'

let cleanup: (() => void) | undefined
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
const fixture = (id = '123', state = 'bookmark') => `<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/author">作者</a></div>
  <a href="/author/status/${id}?s=20"><time>今天</time></a>
  <div data-testid="tweetText">正文</div>
  <div role="link"><div data-testid="User-Name"><a>引用作者</a></div><a href="/quote/status/456"><time>昨天</time></a><div data-testid="tweetText">引用正文</div><button data-testid="removeBookmark"></button></div>
  <div role="group"><button data-testid="${state}">书签</button></div>
</article>`
const action = () => document.querySelector<HTMLButtonElement>('[role="group"] button')!

beforeEach(() => {
  installChromeMock()
  document.body.innerHTML = fixture()
  runtimeSendMessage.mockResolvedValue({ ok: true, created: true })
})
afterEach(() => { cleanup?.(); document.body.innerHTML = '' })

describe('X 书签联动', () => {
  it('extracts only the outer post and strips tracking parameters', () => {
    expect(readPost(document.querySelector('article')!)).toEqual({ url: 'https://x.com/author/status/123', title: '作者：正文' })
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
