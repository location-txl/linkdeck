import type { SameTabRule } from '../types'
import { allowsNavigation, matchesSite } from './rules'
import { createScrollRestoration } from './scroll-restoration'

/** 页面脚本的导航控制器，便于独立验证点击逻辑和清理行为。 */
export type SameTabNavigation = {
  version: 2
  update: (rule: SameTabRule | null) => void
  handleClick: (event: MouseEvent) => void
  handleInput: (event: MouseEvent | KeyboardEvent) => void
  dispose: () => void
}

/**
 * 拦截普通导航，保留原生 window.open 的返回值和浏览器历史。
 * 捕获阶段只改链接的导航目标，不阻断网站自己的点击处理器。
 */
export function createSameTabNavigation(win: Window): SameTabNavigation {
  const doc = win.document
  const originalOpen = win.open
  const scrollRestoration = createScrollRestoration(win)
  let rule: SameTabRule | null = null
  let gesture: { ordinary: boolean, time: number } | undefined
  const changedLinks = new Map<Element, { target: string | null, timer: number }>()

  const restoreLink = (link: Element) => {
    const saved = changedLinks.get(link)
    if (!saved) return
    win.clearTimeout(saved.timer)
    if (link.getAttribute('target') === '_self') {
      if (saved.target === null) link.removeAttribute('target')
      else link.setAttribute('target', saved.target)
    }
    changedLinks.delete(link)
  }

  const handleInput = (event: MouseEvent | KeyboardEvent) => {
    if (!event.isTrusted) return
    const ordinary = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
      ('button' in event ? event.button === 0 : event.key === 'Enter')
    gesture = { ordinary, time: Date.now() }
  }

  const newContext = (target: string | undefined) => {
    const name = target?.toLowerCase() ?? ''
    if (['_self', '_top', '_parent'].includes(name)) return false
    return !target || name === '_blank' || !Array.from(doc.querySelectorAll('iframe[name], frame[name]')).some((frame) => frame.getAttribute('name') === target)
  }

  const wrappedOpen: typeof window.open = (url, target, features) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : ''
    // 空白页、显式弹窗和非用户操作不改写；异步调用仍须处于浏览器的有效用户操作期间。
    const plainFeatures = !features || features.split(',').every((feature) => /^(?:noopener|noreferrer)(?:\s*=\s*[01])?$/i.test(feature.trim()))
    const activeGesture = gesture?.ordinary && (win.navigator.userActivation?.isActive ?? Date.now() - gesture.time < 1_000)
    if (href && activeGesture && plainFeatures && newContext(target) && allowsNavigation(rule, href, win.location.href)) {
      scrollRestoration.save()
      return originalOpen.call(win, url, '_self', features)
    }
    return originalOpen.call(win, url, target, features)
  }

  const handleClick = (event: MouseEvent) => {
    handleInput(event)
    if (!event.isTrusted || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return
    const link = event.composedPath().find((node): node is HTMLAnchorElement | HTMLAreaElement =>
      node instanceof Element && (node.tagName === 'A' || node.tagName === 'AREA'))
    if (!link || link.hasAttribute('download') || !allowsNavigation(rule, link.href, win.location.href)) return
    const target = link.getAttribute('target') ?? doc.querySelector('base[target]')?.getAttribute('target') ?? ''
    if (!newContext(target)) return
    scrollRestoration.save()
    if (changedLinks.has(link)) restoreLink(link)
    const savedTarget = link.getAttribute('target')
    link.setAttribute('target', '_self')
    // 默认导航发生于事件派发之后，因此在下一个任务恢复属性，而不是在微任务中恢复。
    changedLinks.set(link, { target: savedTarget, timer: win.setTimeout(() => restoreLink(link), 0) })
  }

  win.open = wrappedOpen
  win.addEventListener('click', handleClick, true)
  win.addEventListener('pointerdown', handleInput as EventListener, true)
  win.addEventListener('auxclick', handleInput as EventListener, true)
  win.addEventListener('keydown', handleInput as EventListener, true)

  return {
    version: 2,
    update(next) {
      rule = next && matchesSite(win.location.hostname, next.domain) ? next : null
      scrollRestoration.setEnabled(Boolean(rule))
      if (!rule) {
        gesture = undefined
        for (const link of changedLinks.keys()) restoreLink(link)
      }
    },
    handleClick,
    handleInput,
    dispose() {
      rule = null
      scrollRestoration.dispose()
      for (const link of changedLinks.keys()) restoreLink(link)
      if (win.open === wrappedOpen) win.open = originalOpen
      win.removeEventListener('click', handleClick, true)
      win.removeEventListener('pointerdown', handleInput as EventListener, true)
      win.removeEventListener('auxclick', handleInput as EventListener, true)
      win.removeEventListener('keydown', handleInput as EventListener, true)
    },
  }
}
