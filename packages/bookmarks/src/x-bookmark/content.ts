import { MAX_BOOKMARK_TITLE_LENGTH } from '@linkdeck/shared'
import { createNotice } from '../content-notice'
import { X_BOOKMARK_SAVE, X_BOOKMARK_STATE, X_BOOKMARK_STOP, type XBookmarkResponse } from './messages'

type Post = { url: string; title: string }
const ARTICLE = 'article[data-testid="tweet"]'

export function readPost(article: Element): Post | undefined {
  const belongsToPost = (node: Element) => node.closest(ARTICLE) === article && !node.closest('[role="link"]:not(a)')
  const time = [...article.querySelectorAll('a[href] time')].find(belongsToPost)
  const href = time?.closest('a')?.getAttribute('href')
  if (!href) return undefined
  const url = new URL(href, 'https://x.com')
  if (url.origin !== 'https://x.com' || !/^\/[a-zA-Z0-9_]+\/status\/\d+$/.test(url.pathname)) return undefined
  const text = [...article.querySelectorAll('[data-testid="tweetText"]')].find(belongsToPost)?.textContent?.trim()
  const author = [...article.querySelectorAll('[data-testid="User-Name"]')].find(belongsToPost)?.querySelector('a')?.textContent?.trim()
  return {
    url: `${url.origin}${url.pathname}`,
    title: (text ? `${author || url.pathname.split('/')[1]}：${text}` : `${author || url.pathname.split('/')[1]} 的 X 帖子 ${url.pathname.split('/').at(-1)}`).slice(0, MAX_BOOKMARK_TITLE_LENGTH),
  }
}

/** 只跟踪用户主动添加书签后的状态变化，不扫描或导入已有书签。 */
export function installXBookmark(): () => void {
  const pending = new Map<Element, Post>()
  const notice = createNotice()
  const showNotice = notice.show
  const save = async (post: Post) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: X_BOOKMARK_SAVE, ...post }) as XBookmarkResponse | undefined
      if (!response?.ok) throw new Error(response?.error ?? '扩展未响应，请刷新页面后重试。')
      showNotice(response.created ? '已收藏到 LinkDeck · X' : response.tagsMerged ? '已为 LinkDeck 收藏添加 X 标签' : 'LinkDeck 中已收藏这条帖子')
    } catch (error) {
      showNotice(`LinkDeck 收藏失败：${error instanceof Error ? error.message : '请重试。'}`, () => { void save(post) })
    }
  }
  const onClick = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-testid="bookmark"], button[data-testid="removeBookmark"]') : null
    const article = button?.closest(ARTICLE)
    if (!button || !article || button.closest('[role="link"]:not(a)')) return
    pending.delete(article)
    if (button.getAttribute('data-testid') !== 'bookmark') return
    const post = readPost(article)
    if (post) pending.set(article, post)
  }
  const observer = new MutationObserver(() => {
    for (const [article, post] of pending) {
      if (!article.isConnected || readPost(article)?.url !== post.url) {
        pending.delete(article)
        continue
      }
      const saved = [...article.querySelectorAll('button[data-testid="removeBookmark"]')]
        .some((button) => button.closest(ARTICLE) === article && !button.closest('[role="link"]:not(a)'))
      if (saved) {
        pending.delete(article)
        void save(post)
      }
    }
  })
  document.addEventListener('click', onClick, true)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-testid'] })
  const cleanup = () => {
    observer.disconnect()
    pending.clear()
    document.removeEventListener('click', onClick, true)
    notice.dispose()
  }
  return cleanup
}

if (location.origin === 'https://x.com') {
  const scope = globalThis as typeof globalThis & { linkdeckXBookmarkCleanup?: () => void }
  // 后台唤醒会重复注入，保留初始化中的实例以及正在保存和重试的状态。
  if (!scope.linkdeckXBookmarkCleanup) {
    let cancelled = false
    let uninstall: (() => void) | undefined
    const cleanup = () => {
      cancelled = true
      uninstall?.()
      chrome.runtime.onMessage.removeListener(onMessage)
      if (scope.linkdeckXBookmarkCleanup === cleanup) delete scope.linkdeckXBookmarkCleanup
    }
    const onMessage = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === X_BOOKMARK_STOP) cleanup()
      return undefined
    }
    scope.linkdeckXBookmarkCleanup = cleanup
    chrome.runtime.onMessage.addListener(onMessage)
    void chrome.runtime.sendMessage({ type: X_BOOKMARK_STATE }).then((response: XBookmarkResponse) => {
      if (cancelled) return
      if (response.ok && response.enabled) uninstall = installXBookmark()
      else cleanup()
    }).catch(cleanup)
  }
}
