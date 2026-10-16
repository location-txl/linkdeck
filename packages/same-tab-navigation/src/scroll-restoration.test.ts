import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSameTabNavigation, type SameTabNavigation } from './navigation'

const SCROLL_KEY = 'linkdeck:same-tab:scroll'

function ordinaryClick(link?: Element): MouseEvent {
  return { isTrusted: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, composedPath: () => link ? [link, document, window] : [] } as unknown as MouseEvent
}

describe('返回时恢复来源页滚动位置', () => {
  let controller: SameTabNavigation
  let entryKey: string
  let pageHeight: number
  let scrollY: number
  let navType: string
  let scrollTo: ReturnType<typeof vi.fn>
  const descriptors = new Map<string, PropertyDescriptor | undefined>()

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    entryKey = 'home-entry-a'
    pageHeight = 5_000
    scrollY = 3_000
    navType = 'navigate'
    for (const key of ['navigation', 'scrollY', 'innerHeight', 'open', 'scrollTo']) descriptors.set(key, Object.getOwnPropertyDescriptor(window, key))
    descriptors.set('rootHeight', Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight'))
    descriptors.set('performanceEntries', Object.getOwnPropertyDescriptor(performance, 'getEntriesByType'))
    Object.defineProperty(window, 'navigation', { value: { get currentEntry() { return { key: entryKey } } }, configurable: true })
    Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => pageHeight, configurable: true })
    Object.defineProperty(performance, 'getEntriesByType', { value: () => [{ type: navType }], configurable: true })
    Object.defineProperty(window, 'open', { value: vi.fn().mockReturnValue(window), writable: true, configurable: true })
    scrollTo = vi.fn((options: ScrollToOptions) => { scrollY = options.top ?? 0 })
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, writable: true, configurable: true })
    controller = createSameTabNavigation(window)
    controller.update({ domain: window.location.hostname, scope: 'all' })
  })

  afterEach(() => {
    controller.dispose()
    for (const [key, descriptor] of descriptors) {
      const target = key === 'rootHeight' ? document.documentElement : key === 'performanceEntries' ? performance : window
      const property = key === 'rootHeight' ? 'scrollHeight' : key === 'performanceEntries' ? 'getEntriesByType' : key
      if (descriptor) Object.defineProperty(target, property, descriptor)
      else Reflect.deleteProperty(target, property)
    }
    sessionStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('saves scroll before both scripted opens and ordinary links, keyed by history entry', () => {
    controller.handleClick(ordinaryClick())
    window.open('/article/1', '_blank')
    expect(JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '[]')).toContainEqual({ key: 'home-entry-a', x: 0, y: 3_000 })
    entryKey = 'home-entry-b'
    scrollY = 1_200
    const link = document.createElement('a')
    link.href = '/article/2'
    link.target = '_blank'
    controller.handleClick(ordinaryClick(link))
    const snapshots = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '[]')
    expect(snapshots).toContainEqual({ key: 'home-entry-b', x: 0, y: 1_200 })
    expect(snapshots).toContainEqual({ key: 'home-entry-a', x: 0, y: 3_000 })
  })

  it('waits for asynchronous page height before restoring a manual history return', async () => {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify([{ key: entryKey, x: 0, y: 3_000 }]))
    controller.dispose()
    scrollY = 0
    pageHeight = 800
    navType = 'back_forward'
    controller = createSameTabNavigation(window)
    controller.update({ domain: window.location.hostname, scope: 'all' })
    await vi.advanceTimersByTimeAsync(32)
    expect(scrollTo).not.toHaveBeenCalled()
    pageHeight = 5_000
    document.body.append(document.createElement('div'))
    await vi.advanceTimersByTimeAsync(32)
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 3_000, behavior: 'instant' })
    expect(scrollY).toBe(3_000)
  })

  it('updates an existing snapshot when leaving again through a native same-tab link', async () => {
    const link = document.createElement('a')
    link.href = '/article/1'
    link.target = '_blank'
    controller.handleClick(ordinaryClick(link))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    scrollY = 0
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await vi.advanceTimersByTimeAsync(32)
    expect(scrollY).toBe(3_000)

    scrollY = 1_000
    link.target = '_self'
    controller.handleClick(ordinaryClick(link))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    scrollY = 0
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await vi.advanceTimersByTimeAsync(32)
    expect(scrollY).toBe(1_000)
    expect(JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '[]')).toEqual([{ key: entryKey, x: 0, y: 1_000 }])
  })

  it.each([0, 32])('keeps the original snapshot when leaving before restoration completes (%i ms)', async (delay) => {
    const link = document.createElement('a')
    link.href = '/article/1'
    link.target = '_blank'
    controller.handleClick(ordinaryClick(link))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))

    pageHeight = 800
    scrollY = 80
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await vi.advanceTimersByTimeAsync(delay)
    expect(scrollTo).not.toHaveBeenCalled()
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '[]')).toEqual([{ key: entryKey, x: 0, y: 3_000 }])

    pageHeight = 5_000
    scrollY = 0
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    await vi.advanceTimersByTimeAsync(32)
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 3_000, behavior: 'instant' })
    expect(scrollY).toBe(3_000)
  })

  it('does not create leave snapshots without a rewritten navigation or update them while disabled', () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(sessionStorage.getItem(SCROLL_KEY)).toBeNull()
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify([{ key: entryKey, x: 0, y: 3_000 }]))
    controller.update(null)
    scrollY = 1_000
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '[]')).toEqual([{ key: entryKey, x: 0, y: 3_000 }])
  })

  it('cancels pending restoration when the site rule is disabled', async () => {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify([{ key: entryKey, x: 0, y: 3_000 }]))
    controller.dispose()
    pageHeight = 800
    navType = 'back_forward'
    controller = createSameTabNavigation(window)
    controller.update({ domain: window.location.hostname, scope: 'all' })
    controller.update(null)
    pageHeight = 5_000
    document.body.append(document.createElement('div'))
    await vi.advanceTimersByTimeAsync(32)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
