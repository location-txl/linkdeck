import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSameTabNavigation, type SameTabNavigation } from './navigation'
import { SAME_TAB_CONFIG_EVENT } from './messages'

/** jsdom 的派发事件不可能是 isTrusted，用结构化事件验证真实点击处理器。 */
function clickEvent(link?: Element, options: Partial<MouseEvent> = {}): MouseEvent {
  return { isTrusted: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, composedPath: () => link ? [link, document, window] : [], ...options } as MouseEvent
}

describe('页面内导航处理', () => {
  let navigation: SameTabNavigation
  let nativeOpen: ReturnType<typeof vi.fn<typeof window.open>>
  let openDescriptor: PropertyDescriptor
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    nativeOpen = vi.fn<typeof window.open>().mockReturnValue(window)
    openDescriptor = Object.getOwnPropertyDescriptor(window, 'open')!
    Object.defineProperty(window, 'open', { value: nativeOpen, writable: true, configurable: true })
    navigation = createSameTabNavigation(window)
    navigation.update({ domain: window.location.hostname, scope: 'all' })
  })
  afterEach(() => { navigation.dispose(); Object.defineProperty(window, 'open', openDescriptor); vi.useRealTimers(); vi.restoreAllMocks() })

  it('handles dynamically inserted links and restores their attributes after native dispatch', () => {
    const link = document.createElement('a')
    link.href = 'https://scys.com/article/1'
    link.target = '_blank'
    document.body.append(link)
    navigation.handleClick(clickEvent(link))
    expect(link.target).toBe('_self')
    vi.runAllTimers()
    expect(link.target).toBe('_blank')
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('overrides inherited base targets but preserves downloads, modifiers and non-web links', () => {
    const base = document.createElement('base')
    base.target = '_blank'
    document.body.append(base)
    const link = document.createElement('a')
    link.href = 'https://example.com/'
    navigation.handleClick(clickEvent(link))
    expect(link.target).toBe('_self')
    vi.runAllTimers()
    expect(link.hasAttribute('target')).toBe(false)
    link.target = '_blank'
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { isTrusted: false }, { defaultPrevented: true }]) {
      navigation.handleClick(clickEvent(link, options))
      expect(link.target).toBe('_blank')
    }
    link.download = 'file'
    navigation.handleClick(clickEvent(link))
    expect(link.target).toBe('_blank')
    link.removeAttribute('download')
    link.href = 'mailto:a@example.com'
    navigation.handleClick(clickEvent(link))
    expect(link.target).toBe('_blank')
  })

  it('redirects direct scripted opens in a user gesture and retains the native return value', () => {
    navigation.handleClick(clickEvent())
    expect(window.open('https://scys.com/article/1', '_blank', 'noopener,noreferrer')).toBe(window)
    expect(nativeOpen).toHaveBeenLastCalledWith('https://scys.com/article/1', '_self', 'noopener,noreferrer')
    navigation.handleClick(clickEvent(undefined, { ctrlKey: true }))
    window.open('https://scys.com/article/2', '_blank')
    expect(nativeOpen).toHaveBeenLastCalledWith('https://scys.com/article/2', '_blank', undefined)
  })

  it('preserves empty-page and explicit popup flows and expired gestures', () => {
    navigation.handleClick(clickEvent())
    window.open('', '_blank')
    expect(nativeOpen).toHaveBeenLastCalledWith('', '_blank', undefined)
    window.open('https://example.com/login', '_blank', 'popup,width=500')
    expect(nativeOpen).toHaveBeenLastCalledWith('https://example.com/login', '_blank', 'popup,width=500')
    vi.advanceTimersByTime(1_001)
    window.open('https://example.com/', '_blank')
    expect(nativeOpen).toHaveBeenLastCalledWith('https://example.com/', '_blank', undefined)
  })

  it('limits external links and immediately stops on disable or a foreign source rule', () => {
    navigation.update({ domain: window.location.hostname, scope: 'site' })
    navigation.handleClick(clickEvent())
    window.open('https://feishu.cn/doc', '_blank')
    expect(nativeOpen).toHaveBeenLastCalledWith('https://feishu.cn/doc', '_blank', undefined)
    navigation.update(null)
    navigation.handleClick(clickEvent())
    window.open('/article/1', '_blank')
    expect(nativeOpen).toHaveBeenLastCalledWith('/article/1', '_blank', undefined)
    navigation.update({ domain: 'other.example', scope: 'all' })
    window.open('https://scys.com/', '_blank')
    expect(nativeOpen).toHaveBeenLastCalledWith('https://scys.com/', '_blank', undefined)
  })

  it('does not wrap window.open twice when the main script is reinjected', async () => {
    navigation.dispose()
    vi.resetModules()
    await import('./main')
    const first = window.open
    vi.resetModules()
    await import('./main')
    expect(window.open).toBe(first)
    window.dispatchEvent(new CustomEvent(SAME_TAB_CONFIG_EVENT, { detail: { domain: window.location.hostname, scope: 'all' } }))
    const host = window as Window & { __linkdeckSameTabNavigation?: SameTabNavigation }
    host.__linkdeckSameTabNavigation!.handleClick(clickEvent())
    window.open('https://scys.com/', '_blank')
    expect(nativeOpen).toHaveBeenCalledTimes(1)
    host.__linkdeckSameTabNavigation!.dispose()
    delete host.__linkdeckSameTabNavigation
  })

  it('replaces a controller from an older injected version when the extension reloads', async () => {
    Object.defineProperty(navigation, 'version', { value: 1 })
    const oldDispose = vi.spyOn(navigation, 'dispose')
    const host = window as Window & { __linkdeckSameTabNavigation?: SameTabNavigation }
    host.__linkdeckSameTabNavigation = navigation
    vi.resetModules()
    await import('./main')
    expect(oldDispose).toHaveBeenCalledTimes(1)
    expect(host.__linkdeckSameTabNavigation?.version).toBe(2)
    host.__linkdeckSameTabNavigation!.dispose()
    delete host.__linkdeckSameTabNavigation
  })
})
