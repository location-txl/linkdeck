import { createNotice } from '../content-notice'
import { MAX_TAG_NAME_LENGTH } from '../types'
import { getSiteBookmarkSettings, setSiteBookmarkSettings } from './preferences'
import { buildSelector, defaultTagName, normalizeSiteDomain } from './rules'
import { MAX_SITE_RULES, type SiteRule } from './types'

type PickerStep = 'trigger' | 'container' | 'form'

const styleText = (style: Record<string, string>): string =>
  Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}`).join(';')

const FIELD_STYLE = {
  display: 'block', width: '100%', boxSizing: 'border-box', margin: '4px 0 0',
  padding: '6px 8px', borderRadius: '6px', border: '1px solid #4a5568',
  background: '#0d1117', color: '#fff', font: '14px/1.4 system-ui, sans-serif',
} as const

const BUTTON_STYLE = {
  padding: '6px 14px', borderRadius: '6px', cursor: 'pointer',
  border: '1px solid #fff', background: 'transparent', color: '#fff',
} as const

/**
 * 页面内两步引导：先点击要监听的按钮，再点击它所属的卡片（可跳过），
 * 最后在完成面板里确认选择器和标签后保存规则。
 */
export function installPicker(): (() => void) | undefined {
  const domain = normalizeSiteDomain(location.hostname)
  if (!domain) return undefined
  // 选取会话标记：已注入的站点收藏引擎据此暂停保存，点选元素不触发已有规则。
  document.documentElement.dataset.linkdeckPicking = ''

  const notice = createNotice()
  const root = document.createElement('div')
  root.dataset.linkdeckPicker = ''
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none', margin: '0', font: '14px/1.5 system-ui, sans-serif', color: '#fff' })
  const highlight = document.createElement('div')
  Object.assign(highlight.style, {
    position: 'fixed', zIndex: '2147483645', pointerEvents: 'none', display: 'none', margin: '0',
    border: '2px solid #4a9eff', borderRadius: '4px', boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.25)',
  })
  const banner = document.createElement('div')
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0', pointerEvents: 'auto',
    padding: '10px 16px', background: '#17212b', boxShadow: '0 4px 24px #0004',
    display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center',
  })

  let step: PickerStep = 'trigger'
  let triggerElement: Element | undefined

  const setBannerText = (text: string) => {
    banner.replaceChildren()
    banner.append(document.createTextNode(text))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '取消'
    Object.assign(cancel.style, { ...BUTTON_STYLE, padding: '4px 10px' })
    cancel.onclick = cleanup
    banner.append(cancel)
  }

  const buildForm = () => {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      pointerEvents: 'auto', width: 'min(420px, 90vw)', boxSizing: 'border-box',
      padding: '16px', borderRadius: '12px', background: '#17212b', boxShadow: '0 4px 24px #0004',
    })
    panel.innerHTML = `
      <h2 style="margin:0 0 4px;font-size:16px;color:#fff;">LinkDeck 站点收藏规则</h2>
      <p style="margin:0 0 12px;color:#8b949e;">${domain}</p>
      <label style="display:block;margin:0;color:#fff;">触发按钮选择器
        <input data-linkdeck-trigger style="${styleText(FIELD_STYLE)}" />
        <small data-linkdeck-trigger-count style="display:block;margin-top:2px;color:#8b949e;"></small>
      </label>
      <label style="display:block;margin:10px 0 0;color:#fff;">卡片容器选择器（留空 = 收藏当前页面）
        <input data-linkdeck-container placeholder="包含按钮的卡片，如 article" style="${styleText(FIELD_STYLE)}" />
        <small data-linkdeck-container-count style="display:block;margin-top:2px;color:#8b949e;"></small>
      </label>
      <label style="display:block;margin:10px 0 0;color:#fff;">收藏标签
        <input data-linkdeck-tag style="${styleText(FIELD_STYLE)}" />
      </label>
      <p data-linkdeck-error role="alert" style="display:none;margin:10px 0 0;color:#f85149;"></p>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button data-linkdeck-cancel type="button" style="${styleText(BUTTON_STYLE)}">取消</button>
        <button data-linkdeck-save type="button" style="${styleText({ ...BUTTON_STYLE, background: '#2f81f7', borderColor: '#2f81f7' })}">保存规则</button>
      </div>
    `
    return panel
  }

  const showForm = () => {
    step = 'form'
    highlight.style.display = 'none'
    root.replaceChildren(buildForm())

    const triggerInput = root.querySelector<HTMLInputElement>('[data-linkdeck-trigger]')!
    const triggerCount = root.querySelector<HTMLElement>('[data-linkdeck-trigger-count]')!
    const containerInput = root.querySelector<HTMLInputElement>('[data-linkdeck-container]')!
    const containerCount = root.querySelector<HTMLElement>('[data-linkdeck-container-count]')!
    const tagInput = root.querySelector<HTMLInputElement>('[data-linkdeck-tag]')!
    const error = root.querySelector<HTMLElement>('[data-linkdeck-error]')!
    triggerInput.value = triggerElement ? buildSelector(triggerElement) : ''
    tagInput.value = defaultTagName(domain)

    const showError = (text: string) => {
      error.textContent = text
      error.style.display = 'block'
    }
    // 返回选择器是否有效；同时更新命中数，帮助判断选择器的覆盖范围。
    const countMatches = (input: HTMLInputElement, output: HTMLElement): boolean => {
      const selector = input.value.trim()
      if (!selector) { output.textContent = '留空时收藏当前页面'; return input === containerInput }
      try {
        output.textContent = `命中 ${document.querySelectorAll(selector).length} 个元素`
        return true
      } catch {
        output.textContent = '无效选择器'
        return false
      }
    }
    const refreshCounts = () => {
      countMatches(triggerInput, triggerCount)
      countMatches(containerInput, containerCount)
    }
    triggerInput.addEventListener('input', refreshCounts)
    containerInput.addEventListener('input', refreshCounts)
    refreshCounts()

    root.querySelector<HTMLButtonElement>('[data-linkdeck-cancel]')!.onclick = cleanup
    root.querySelector<HTMLButtonElement>('[data-linkdeck-save]')!.onclick = () => void (async () => {
      const triggerSelector = triggerInput.value.trim()
      if (!triggerSelector || !countMatches(triggerInput, triggerCount)) { showError('请填写有效的触发按钮选择器。'); return }
      if (!countMatches(containerInput, containerCount)) { showError('卡片容器选择器无效。'); return }
      const containerSelector = containerInput.value.trim()
      const tagName = (tagInput.value.trim() || defaultTagName(domain)).slice(0, MAX_TAG_NAME_LENGTH)
      try {
        const settings = await getSiteBookmarkSettings()
        if (settings.rules.length >= MAX_SITE_RULES) {
          showError(`规则数量已达上限（${MAX_SITE_RULES} 条），请先删除不需要的规则。`)
          return
        }
        const now = Date.now()
        const rule: SiteRule = {
          id: crypto.randomUUID(), domain, name: domain, enabled: true,
          triggerSelector,
          ...(containerSelector ? { containerSelector } : {}),
          url: { source: containerSelector ? { kind: 'closestLink' } : { kind: 'pageUrl' } },
          title: { source: { kind: 'pageTitle' } },
          tagName, createdAt: now, updatedAt: now,
        }
        // 保存即开启总开关：入口在设置面板，创建后应立即可用。
        await setSiteBookmarkSettings({ ...settings, enabled: true, rules: [...settings.rules, rule] })
        // 成功提示靠自身超时消失，cleanup 不回收通知。
        notice.show('规则已保存，现在点击该按钮试试收藏。')
        cleanup()
      } catch {
        showError('保存规则失败，请重试。')
      }
    })()
  }

  const onMouseMove = (event: MouseEvent) => {
    if (step === 'form' || !(event.target instanceof Element)) return
    if (event.target.closest('[data-linkdeck-picker]')) return
    const rect = event.target.getBoundingClientRect()
    Object.assign(highlight.style, {
      display: 'block', top: `${rect.top}px`, left: `${rect.left}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    })
  }

  const onClick = (event: MouseEvent) => {
    if (step === 'form' || !(event.target instanceof Element)) return
    if (event.target.closest('[data-linkdeck-picker]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (step === 'trigger') {
      triggerElement = event.target
      step = 'container'
      setBannerText('② 点击该按钮所属的卡片/文章（用于提取标题和链接），按 Esc 跳过则收藏当前页面')
      return
    }
    if (step === 'container') {
      if (!triggerElement || !event.target.contains(triggerElement)) {
        setBannerText('② 该区域不包含刚才选中的按钮，请点击包含它的卡片；按 Esc 跳过则收藏当前页面')
        return
      }
      const useContainer = event.target !== triggerElement
      step = 'form'
      showForm()
      if (useContainer) {
        const containerInput = root.querySelector<HTMLInputElement>('[data-linkdeck-container]')
        if (containerInput) {
          containerInput.value = buildSelector(event.target)
          containerInput.dispatchEvent(new Event('input'))
        }
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('[data-linkdeck-picker]'))) return
    if (step === 'trigger') { cleanup(); return }
    if (step === 'container') showForm()
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    delete document.documentElement.dataset.linkdeckPicking
    root.remove()
    highlight.remove()
  }

  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.body.append(highlight, root)
  root.append(banner)
  setBannerText('① 点击要监听的按钮（如网站的收藏/点赞按钮）')
  return cleanup
}

// 非扩展环境（测试、工具链）加载此模块时跳过安装。
if ((location.protocol === 'https:' || location.protocol === 'http:') && typeof chrome !== 'undefined') {
  const scope = globalThis as typeof globalThis & { linkdeckSiteBookmarkPickerCleanup?: () => void }
  // 重复注入时保留进行中的选取会话；会话结束后守卫清除，允许重新选取。
  if (!scope.linkdeckSiteBookmarkPickerCleanup) {
    const cleanup = installPicker()
    if (cleanup) {
      scope.linkdeckSiteBookmarkPickerCleanup = () => {
        cleanup()
        delete scope.linkdeckSiteBookmarkPickerCleanup
      }
    }
  }
}
