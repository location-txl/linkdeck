const SCROLL_STORAGE_KEY = 'linkdeck:same-tab:scroll'
const MAX_SNAPSHOTS = 20
const RESTORE_TIMEOUT_MS = 10_000

/** 仅保存历史条目标识和滚动坐标，不保存网址或页面正文。 */
type ScrollSnapshot = { key: string, x: number, y: number }
type EntryWindow = Window & { navigation?: { currentEntry?: { key: string } } }

/** 当前标签页导航的滚动恢复生命周期。 */
export type ScrollRestoration = {
  save: () => void
  setEnabled: (enabled: boolean) => void
  dispose: () => void
}

/**
 * 网站关闭原生恢复时，按浏览器历史条目的 key 恢复来源位置。
 * 坐标仅写入网站当前标签页的 sessionStorage；等待异步内容长到目标位置，
 * 恢复完成、用户开始操作或超时后立即停止观察，不持续控制网站滚动。
 */
export function createScrollRestoration(win: Window): ScrollRestoration {
  let enabled = false
  let handledKey: string | undefined
  let stopPending = () => undefined as void
  const entryKey = () => (win as EntryWindow).navigation?.currentEntry?.key
  const isReturn = () => (win.performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined)?.type === 'back_forward'

  const read = (): ScrollSnapshot[] => {
    try {
      const value: unknown = JSON.parse(win.sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? '[]')
      if (!Array.isArray(value)) return []
      return value.filter((item): item is ScrollSnapshot => Boolean(item && typeof item.key === 'string' &&
        typeof item.x === 'number' && Number.isFinite(item.x) && item.x >= 0 &&
        typeof item.y === 'number' && Number.isFinite(item.y) && item.y >= 0)).slice(0, MAX_SNAPSHOTS)
    } catch {
      // 网站禁用存储或写入无效内容时，仍允许正常导航。
      return []
    }
  }

  const restore = () => {
    const key = entryKey()
    if (!enabled || !key || key === handledKey) return
    const saved = read().find((snapshot) => snapshot.key === key)
    if (!saved) return
    stopPending()
    let frame: number | undefined
    let timeout: number
    let resize: ResizeObserver | undefined
    const cancelByUser = (event: Event) => {
      if (!event.isTrusted) return
      handledKey = key
      stopPending()
    }
    const stop = () => {
      mutations.disconnect()
      resize?.disconnect()
      if (frame !== undefined) win.cancelAnimationFrame(frame)
      win.clearTimeout(timeout)
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) win.removeEventListener(event, cancelByUser, true)
      stopPending = () => undefined
    }
    const attempt = () => {
      frame = undefined
      if (!enabled || entryKey() !== key) {
        stop()
        return
      }
      const root = win.document.scrollingElement ?? win.document.documentElement
      if (!root || root.scrollHeight - win.innerHeight + 1 < saved.y) return
      win.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' })
      handledKey = key
      stop()
    }
    const schedule = () => {
      if (frame === undefined) frame = win.requestAnimationFrame(attempt)
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(win.document, { childList: true, subtree: true, attributes: true })
    if (typeof ResizeObserver !== 'undefined' && win.document.documentElement) {
      resize = new ResizeObserver(schedule)
      resize.observe(win.document.documentElement)
    }
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) win.addEventListener(event, cancelByUser, true)
    timeout = win.setTimeout(stop, RESTORE_TIMEOUT_MS)
    stopPending = stop
    schedule()
  }

  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted || isReturn()) restore() }
  const onPageHide = () => {
    stopPending()
    handledKey = undefined
  }
  win.addEventListener('pageshow', onPageShow)
  win.addEventListener('pagehide', onPageHide)
  win.addEventListener('popstate', restore)

  return {
    save() {
      const key = entryKey()
      if (!enabled || !key) return
      stopPending()
      handledKey = undefined
      const snapshot = { key, x: Math.max(0, win.scrollX), y: Math.max(0, win.scrollY) }
      try {
        win.sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify([snapshot, ...read().filter((item) => item.key !== key)].slice(0, MAX_SNAPSHOTS)))
      } catch {
        // 配额不足或存储被禁用不阻断链接打开。
      }
    },
    setEnabled(value) {
      enabled = value
      if (!enabled) stopPending()
      else if (entryKey() && isReturn()) restore()
    },
    dispose() {
      enabled = false
      stopPending()
      win.removeEventListener('pageshow', onPageShow)
      win.removeEventListener('pagehide', onPageHide)
      win.removeEventListener('popstate', restore)
    },
  }
}
