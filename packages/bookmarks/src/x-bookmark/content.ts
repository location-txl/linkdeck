import { MAX_BOOKMARK_TITLE_LENGTH } from '@linkdeck/shared'
import { X_BOOKMARK_SAVE, X_BOOKMARK_STATE, X_BOOKMARK_STOP, type XBookmarkResponse } from './messages'

type Post = { url: string; title: string }
const ARTICLE = 'article[data-testid="tweet"]'

export function readPost(article: Element): Post | undefined {
  const belongsToPost = (node: Element) => node.closest(ARTICLE) === article && !node.closest('[role="link"]')
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
  let active = true
  let notice: HTMLDivElement | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const showNotice = (text: string, retry?: () => void) => {
    if (!active) return
    notice?.remove()
    clearTimeout(noticeTimer)
    notice = document.createElement('div')
    notice.setAttribute('role', 'status')
    notice.dataset.linkdeckNotice = ''
    Object.assign(notice.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '12px 18px', borderRadius: '12px',
      background: '#17212b', color: '#fff', font: '14px/1.5 system-ui, sans-serif',
      boxShadow: '0 4px 24px #0004', maxWidth: 'min(480px, 85vw)',
    })
    notice.append(document.createTextNode(text))
    if (retry) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '重试'
      Object.assign(button.style, { marginLeft: '12px', color: '#fff', background: 'transparent', border: '1px solid #fff', borderRadius: '4px', cursor: 'pointer' })
      button.onclick = () => { button.disabled = true; retry() }
      notice.append(button)
    }
    document.body.append(notice)
    noticeTimer = setTimeout(() => notice?.remove(), retry ? 15000 : 4000)
  }
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
    if (!button || !article || button.closest('[role="link"]')) return
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
        .some((button) => button.closest(ARTICLE) === article && !button.closest('[role="link"]'))
      if (saved) {
        pending.delete(article)
        void save(post)
      }
    }
  })
  document.addEventListener('click', onClick, true)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-testid'] })
  const onMessage = (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === X_BOOKMARK_STOP) cleanup()
    return undefined
  }
  const cleanup = () => {
    active = false
    observer.disconnect()
    pending.clear()
    document.removeEventListener('click', onClick, true)
    chrome.runtime.onMessage.removeListener(onMessage)
    notice?.remove()
    clearTimeout(noticeTimer)
  }
  chrome.runtime.onMessage.addListener(onMessage)
  return cleanup
}

if (location.origin === 'https://x.com') {
  const scope = globalThis as typeof globalThis & { linkdeckXBookmarkCleanup?: () => void }
  scope.linkdeckXBookmarkCleanup?.()
  // 重复注入与权限撤销都可能发生在状态读取期间，旧实例不能重新启动。
  let cancelled = false
  scope.linkdeckXBookmarkCleanup = () => { cancelled = true }
  void chrome.runtime.sendMessage({ type: X_BOOKMARK_STATE }).then((response: XBookmarkResponse) => {
    if (!cancelled && response.ok && response.enabled) scope.linkdeckXBookmarkCleanup = installXBookmark()
  }).catch(() => undefined)
}
