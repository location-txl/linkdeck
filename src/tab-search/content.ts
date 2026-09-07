import { searchTabs } from './fuzzy-search'
import type { TabSearchMessage, TabSearchResponse, TabSearchTab } from './messages'

(() => {
  const HOST_ID = 'linkdeck-tab-search-root'
  const REFRESH_EVENT = 'linkdeck:refresh'
  const GET_TABS_MESSAGE = 'tab-search:get-tabs'
  const ACTIVATE_TAB_MESSAGE = 'tab-search:activate-tab'

  const STYLES = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: block;
      color: #25211c;
      font-family: "Avenir Next", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    * {
      box-sizing: border-box;
    }

    button,
    input {
      font: inherit;
    }

    button {
      border: 0;
      color: inherit;
      cursor: pointer;
    }

    .tab-search__layer {
      position: relative;
      min-height: 100%;
      pointer-events: none;
    }

    .tab-search__backdrop {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      cursor: default;
      pointer-events: auto;
    }

    .tab-search__palette {
      position: relative;
      z-index: 1;
      width: min(600px, calc(100vw - 32px));
      max-height: min(650px, calc(100vh - 32px));
      margin: min(12vh, 96px) auto 0;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 18px;
      background:
        radial-gradient(circle at 100% 0%, rgba(239, 189, 85, 0.2), transparent 32%),
        radial-gradient(circle at 0% 100%, rgba(223, 91, 54, 0.12), transparent 35%),
        #fcfaf4;
      box-shadow: 0 24px 75px rgba(21, 17, 12, 0.3), 0 3px 10px rgba(21, 17, 12, 0.15);
      pointer-events: auto;
      animation: tab-search-in 150ms ease-out both;
    }

    .tab-search__palette::before {
      position: absolute;
      inset: 0;
      z-index: -1;
      background-image: linear-gradient(rgba(80, 65, 47, 0.026) 1px, transparent 1px);
      background-size: 100% 5px;
      content: "";
      pointer-events: none;
    }

    .tab-search__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 20px 22px 13px;
    }

    .tab-search__brand {
      display: flex;
      align-items: center;
      gap: 11px;
      min-width: 0;
    }

    .tab-search__mark {
      display: grid;
      width: 35px;
      height: 35px;
      place-items: center;
      border-radius: 11px 11px 11px 4px;
      background: #25211c;
      color: #f5f0e6;
      box-shadow: 3px 3px 0 #efbd55;
      font-family: Georgia, serif;
      font-size: 23px;
      line-height: 1;
    }

    .tab-search__eyebrow {
      display: block;
      margin-bottom: 2px;
      color: #9d958a;
      font-family: "Avenir Next Condensed", "DIN Condensed", sans-serif;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.16em;
    }

    .tab-search__title {
      color: #25211c;
      font-family: "Iowan Old Style", "Baskerville", "Songti SC", serif;
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.025em;
      line-height: 1;
    }

    .tab-search__scope {
      margin-top: 5px;
      color: #6d665d;
      font-size: 10px;
    }

    .tab-search__close {
      display: inline-flex;
      min-width: 42px;
      height: 27px;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      border: 1px solid #ddd4c5;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.25);
      color: #6d665d;
      font-size: 10px;
      font-weight: 700;
    }

    .tab-search__close:hover,
    .tab-search__close:focus-visible {
      border-color: #df5b36;
      background: #f8ded3;
      color: #b93d25;
      outline: none;
    }

    .tab-search__field {
      display: flex;
      min-height: 56px;
      align-items: center;
      gap: 11px;
      margin: 0 18px;
      padding: 0 14px;
      border: 1px solid #cfc2b0;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.58);
      box-shadow: 0 4px 14px rgba(62, 49, 31, 0.06) inset;
    }

    .tab-search__field:focus-within {
      border-color: #df5b36;
      box-shadow: 0 0 0 3px rgba(223, 91, 54, 0.12);
    }

    .tab-search__glyph {
      flex: 0 0 auto;
      color: #df5b36;
      font-family: Georgia, serif;
      font-size: 28px;
      line-height: 1;
      transform: rotate(-17deg);
    }

    .tab-search__input {
      min-width: 0;
      flex: 1;
      border: 0;
      outline: 0;
      background: transparent;
      color: #25211c;
      font-size: 16px;
      font-weight: 600;
    }

    .tab-search__input::placeholder {
      color: #9d958a;
      font-weight: 500;
    }

    .tab-search__shortcut {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 2px;
      color: #9d958a;
      font-size: 10px;
    }

    .tab-search__shortcut kbd {
      padding: 3px 5px;
      border: 1px solid #ddd4c5;
      border-bottom-width: 2px;
      border-radius: 5px;
      background: #eee7da;
      font-family: "SF Mono", "Cascadia Mono", monospace;
      font-size: 9px;
      line-height: 1;
    }

    .tab-search__hint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 22px 9px;
      color: #9d958a;
      font-size: 10px;
    }

    .tab-search__results {
      max-height: min(430px, 52vh);
      padding: 0 9px 9px;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-color: #cfc2b0 transparent;
      scrollbar-width: thin;
    }

    .tab-search__item {
      display: flex;
      width: 100%;
      min-height: 62px;
      align-items: center;
      gap: 11px;
      padding: 9px 12px;
      border: 1px solid transparent;
      border-radius: 11px;
      background: transparent;
      text-align: left;
    }

    .tab-search__item:hover,
    .tab-search__item[data-selected="true"] {
      border-color: rgba(223, 91, 54, 0.22);
      background: rgba(248, 222, 211, 0.62);
      outline: none;
    }

    .tab-search__item:focus-visible {
      border-color: #df5b36;
      outline: 2px solid rgba(223, 91, 54, 0.22);
      outline-offset: -2px;
    }

    .tab-search__icon {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      flex: 0 0 auto;
      overflow: hidden;
      border: 1px solid #ddd4c5;
      border-radius: 9px;
      background: #eee7da;
      color: #b93d25;
      font-family: Georgia, serif;
      font-size: 17px;
      font-weight: 700;
    }

    .tab-search__icon img {
      width: 19px;
      height: 19px;
      object-fit: contain;
    }

    .tab-search__copy {
      min-width: 0;
      flex: 1;
    }

    .tab-search__name-line {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 7px;
    }

    .tab-search__name {
      overflow: hidden;
      color: #25211c;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tab-search__active,
    .tab-search__pinned {
      flex: 0 0 auto;
      padding: 2px 5px;
      border-radius: 999px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1.2;
    }

    .tab-search__active {
      background: #f8ded3;
      color: #b93d25;
    }

    .tab-search__pinned {
      background: #efbd55;
      color: #5b3d18;
    }

    .tab-search__url {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      color: #9d958a;
      font-family: "SF Mono", "Cascadia Mono", monospace;
      font-size: 9px;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tab-search__index {
      display: grid;
      min-width: 25px;
      height: 25px;
      place-items: center;
      border-radius: 7px;
      color: #9d958a;
      font-family: "SF Mono", "Cascadia Mono", monospace;
      font-size: 9px;
    }

    .tab-search__item[data-selected="true"] .tab-search__index {
      background: #df5b36;
      color: #fffaf6;
    }

    .tab-search__empty {
      padding: 24px 18px 29px;
      color: #6d665d;
      font-size: 12px;
      text-align: center;
    }

    .tab-search__empty strong {
      display: block;
      color: #25211c;
      font-family: "Iowan Old Style", "Baskerville", "Songti SC", serif;
      font-size: 17px;
    }

    .tab-search__empty span {
      display: block;
      margin-top: 6px;
      color: #9d958a;
      font-size: 10px;
    }

    .tab-search__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 22px 13px;
      border-top: 1px solid rgba(221, 212, 197, 0.7);
      color: #9d958a;
      font-size: 9px;
    }

    .tab-search__loading {
      padding: 20px 12px;
      color: #9d958a;
      font-size: 11px;
      text-align: center;
    }

    @keyframes tab-search-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (prefers-color-scheme: dark) {
      :host {
        color: #f5eee4;
      }

      .tab-search__palette {
        border-color: rgba(255, 255, 255, 0.12);
        background:
          radial-gradient(circle at 100% 0%, rgba(232, 186, 89, 0.16), transparent 32%),
          radial-gradient(circle at 0% 100%, rgba(255, 131, 94, 0.12), transparent 35%),
          #2a2621;
        box-shadow: 0 24px 75px rgba(0, 0, 0, 0.52), 0 3px 10px rgba(0, 0, 0, 0.32);
      }

      .tab-search__mark {
        background: #f5eee4;
        color: #201d19;
        box-shadow: 3px 3px 0 #e8ba59;
      }

      .tab-search__title,
      .tab-search__name,
      .tab-search__empty strong {
        color: #f5eee4;
      }

      .tab-search__scope,
      .tab-search__close,
      .tab-search__empty {
        color: #b6aca0;
      }

      .tab-search__close,
      .tab-search__field,
      .tab-search__icon,
      .tab-search__shortcut kbd {
        border-color: #5b5046;
      }

      .tab-search__close,
      .tab-search__field {
        background: rgba(32, 29, 25, 0.52);
      }

      .tab-search__input {
        color: #f5eee4;
      }

      .tab-search__shortcut kbd,
      .tab-search__icon {
        background: #302b25;
      }

      .tab-search__item:hover,
      .tab-search__item[data-selected="true"] {
        border-color: rgba(255, 131, 94, 0.3);
        background: rgba(72, 45, 37, 0.72);
      }

      .tab-search__url,
      .tab-search__index,
      .tab-search__empty span,
      .tab-search__footer,
      .tab-search__hint,
      .tab-search__loading {
        color: #81776d;
      }

      .tab-search__footer {
        border-top-color: rgba(69, 61, 53, 0.75);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .tab-search__palette {
        animation: none;
      }
    }
  `

  function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag)
    if (className) element.className = className
    return element
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '读取标签页失败，请重新尝试。'
  }

  function isSafeFaviconUrl(value: string): boolean {
    try {
      return ['http:', 'https:', 'data:', 'chrome:', 'chrome-extension:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }

  class TabSearchOverlay {
    private readonly host: HTMLDivElement
    private readonly input: HTMLInputElement
    private readonly count: HTMLSpanElement
    private readonly results: HTMLDivElement
    private readonly empty: HTMLDivElement
    private readonly status: HTMLSpanElement
    private tabs: TabSearchTab[] = []
    private visibleTabs: TabSearchTab[] = []
    private query = ''
    private selectedIndex = 0
    private loading = true
    private error: string | undefined
    private closed = false

    constructor(host: HTMLDivElement, shadow: ShadowRoot) {
      this.host = host

      const style = createElement('style')
      style.textContent = STYLES

      const layer = createElement('div', 'tab-search__layer')
      const backdrop = createElement('button', 'tab-search__backdrop')
      backdrop.type = 'button'
      backdrop.setAttribute('aria-label', '关闭标签页搜索')
      backdrop.addEventListener('click', () => this.close())

      const palette = createElement('section', 'tab-search__palette')
      palette.setAttribute('role', 'dialog')
      palette.setAttribute('aria-modal', 'true')
      palette.setAttribute('aria-label', '搜索标签页')

      const header = createElement('header', 'tab-search__header')
      const brand = createElement('div', 'tab-search__brand')
      const mark = createElement('span', 'tab-search__mark')
      mark.textContent = '⌕'
      mark.setAttribute('aria-hidden', 'true')
      const brandCopy = createElement('div')
      const eyebrow = createElement('span', 'tab-search__eyebrow')
      eyebrow.textContent = 'LINKDECK / QUICK SWITCH'
      const title = createElement('h1', 'tab-search__title')
      title.textContent = '搜索标签页'
      const scope = createElement('div', 'tab-search__scope')
      scope.textContent = '当前浏览器窗口 · 输入即定位'
      brandCopy.append(eyebrow, title, scope)
      brand.append(mark, brandCopy)

      const closeButton = createElement('button', 'tab-search__close')
      closeButton.type = 'button'
      closeButton.textContent = 'Esc'
      closeButton.setAttribute('aria-label', '关闭标签页搜索')
      closeButton.addEventListener('click', () => this.close())
      header.append(brand, closeButton)

      const field = createElement('label', 'tab-search__field')
      const glyph = createElement('span', 'tab-search__glyph')
      glyph.textContent = '⌕'
      glyph.setAttribute('aria-hidden', 'true')
      this.input = createElement('input', 'tab-search__input')
      this.input.type = 'search'
      this.input.placeholder = 'Search tabs...'
      this.input.autocomplete = 'off'
      this.input.spellcheck = false
      this.input.setAttribute('aria-label', '搜索标签页')
      this.input.setAttribute('aria-controls', 'linkdeck-tab-search-results')
      this.input.addEventListener('input', () => {
        this.query = this.input.value
        this.selectedIndex = 0
        this.render()
      })
      this.input.addEventListener('keydown', this.handleKeyDown)
      const shortcut = createElement('span', 'tab-search__shortcut')
      shortcut.setAttribute('aria-hidden', 'true')
      const shortcutKey = createElement('kbd')
      shortcutKey.textContent = '⌘⇧P'
      shortcut.append(shortcutKey)
      field.append(glyph, this.input, shortcut)

      const hint = createElement('div', 'tab-search__hint')
      hint.textContent = '↑ ↓ 选择　·　Enter 打开　·　Esc 关闭'
      this.count = createElement('span', 'tab-search__count')
      hint.append(this.count)

      this.results = createElement('div', 'tab-search__results')
      this.results.id = 'linkdeck-tab-search-results'
      this.results.setAttribute('role', 'listbox')
      this.results.setAttribute('aria-label', '当前窗口标签页')

      this.empty = createElement('div', 'tab-search__empty')
      this.empty.hidden = true

      const footer = createElement('footer', 'tab-search__footer')
      this.status = createElement('span')
      this.status.setAttribute('aria-live', 'polite')
      const source = createElement('span')
      source.textContent = '本地读取 · 不上传'
      footer.append(this.status, source)

      palette.append(header, field, hint, this.results, this.empty, footer)
      layer.append(backdrop, palette)
      shadow.append(style, layer)
    }

    mount(): void {
      this.host.addEventListener(REFRESH_EVENT, this.handleRefresh)
      this.render()
      this.focusSearch(false)
      void this.loadTabs(false)
    }

    private readonly handleRefresh = () => {
      if (this.closed) return
      void this.loadTabs(true)
    }

    private readonly handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.close()
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (this.visibleTabs.length === 0) return
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        this.selectedIndex = (this.selectedIndex + direction + this.visibleTabs.length) % this.visibleTabs.length
        this.render()
        this.scrollSelectionIntoView()
        return
      }

      if (event.key === 'Enter' && this.visibleTabs[this.selectedIndex]) {
        event.preventDefault()
        void this.selectTab(this.visibleTabs[this.selectedIndex])
      }
    }

    private async loadTabs(selectQuery: boolean): Promise<void> {
      this.loading = true
      this.error = undefined
      this.render()

      try {
        const message: TabSearchMessage = { type: GET_TABS_MESSAGE }
        const response = await chrome.runtime.sendMessage(message) as TabSearchResponse | undefined
        if (!response) throw new Error('读取标签页失败，请重新尝试。')
        if (!response.ok) throw new Error(response.error)
        if (!('tabs' in response)) throw new Error('标签页数据格式无效。')

        this.tabs = response.tabs
        this.loading = false
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, searchTabs(this.tabs, this.query).length - 1))
        this.render()
        this.focusSearch(selectQuery)
      } catch (error: unknown) {
        if (this.closed) return
        this.loading = false
        this.error = errorMessage(error)
        this.render()
        this.focusSearch(selectQuery)
      }
    }

    private render(): void {
      this.visibleTabs = searchTabs(this.tabs, this.query)
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.visibleTabs.length - 1))
      this.count.textContent = this.loading ? '读取中…' : `${this.visibleTabs.length} / ${this.tabs.length}`
      this.status.textContent = this.error ? this.error : this.loading ? '正在读取标签页…' : `${this.tabs.length} 个标签页`
      this.results.textContent = ''
      this.empty.textContent = ''
      this.empty.hidden = true

      if (this.loading) {
        const loading = createElement('div', 'tab-search__loading')
        loading.textContent = '正在读取当前窗口的标签页…'
        this.results.append(loading)
        this.input.removeAttribute('aria-activedescendant')
        return
      }

      if (this.visibleTabs.length === 0) {
        const heading = createElement('strong')
        heading.textContent = this.error ? '无法读取标签页' : this.tabs.length === 0 ? '当前窗口没有标签页' : '没有找到匹配的标签页'
        const description = createElement('span')
        description.textContent = this.error ?? (this.tabs.length === 0 ? '请打开一个网页后重新尝试。' : '试试标题、网址或连续输入几个字符。')
        this.empty.append(heading, description)
        this.empty.hidden = false
        this.input.removeAttribute('aria-activedescendant')
        return
      }

      this.visibleTabs.forEach((tab, resultIndex) => {
        const item = createElement('button', 'tab-search__item')
        item.type = 'button'
        item.id = `linkdeck-tab-search-option-${tab.id}`
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', String(resultIndex === this.selectedIndex))
        item.dataset.selected = String(resultIndex === this.selectedIndex)
        item.addEventListener('click', () => void this.selectTab(tab))

        const icon = this.createTabIcon(tab)
        const copy = createElement('span', 'tab-search__copy')
        const nameLine = createElement('span', 'tab-search__name-line')
        const name = createElement('strong', 'tab-search__name')
        name.textContent = tab.title
        nameLine.append(name)
        if (tab.active) {
          const active = createElement('span', 'tab-search__active')
          active.textContent = '当前'
          nameLine.append(active)
        }
        if (tab.pinned) {
          const pinned = createElement('span', 'tab-search__pinned')
          pinned.textContent = '固定'
          nameLine.append(pinned)
        }
        const url = createElement('small', 'tab-search__url')
        url.textContent = tab.url || '网址不可用'
        copy.append(nameLine, url)

        const tabIndex = createElement('span', 'tab-search__index')
        tabIndex.textContent = String(tab.index + 1)
        tabIndex.setAttribute('aria-hidden', 'true')
        item.append(icon, copy, tabIndex)
        this.results.append(item)
      })

      this.input.setAttribute('aria-activedescendant', `linkdeck-tab-search-option-${this.visibleTabs[this.selectedIndex].id}`)
    }

    private createTabIcon(tab: TabSearchTab): HTMLSpanElement {
      const icon = createElement('span', 'tab-search__icon')
      icon.setAttribute('aria-hidden', 'true')
      if (!tab.favIconUrl || !isSafeFaviconUrl(tab.favIconUrl)) {
        icon.textContent = '◌'
        return icon
      }

      const image = createElement('img')
      image.src = tab.favIconUrl
      image.alt = ''
      image.referrerPolicy = 'no-referrer'
      image.decoding = 'async'
      image.addEventListener('error', () => {
        image.remove()
        icon.textContent = '◌'
      })
      icon.append(image)
      return icon
    }

    private focusSearch(selectQuery: boolean): void {
      this.input.focus()
      if (selectQuery) this.input.select()
    }

    private scrollSelectionIntoView(): void {
      const selected = this.results.querySelector<HTMLElement>('[data-selected="true"]')
      if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest' })
    }

    private async selectTab(tab: TabSearchTab): Promise<void> {
      this.close()
      try {
        const message: TabSearchMessage = { type: ACTIVATE_TAB_MESSAGE, tabId: tab.id }
        const response = await chrome.runtime.sendMessage(message) as TabSearchResponse | undefined
        if (response && !response.ok) console.warn('标签页搜索激活失败', response.error)
      } catch (error: unknown) {
        console.warn('标签页搜索激活失败', error)
      }
    }

    private close(): void {
      if (this.closed) return
      this.closed = true
      this.host.removeEventListener(REFRESH_EVENT, this.handleRefresh)
      this.host.remove()
    }
  }

  function mountOverlay(): void {
    const existing = document.getElementById(HOST_ID)
    if (existing) {
      existing.dispatchEvent(new CustomEvent(REFRESH_EVENT))
      return
    }

    const root = document.documentElement
    if (!root) return
    const host = document.createElement('div')
    host.id = HOST_ID
    const shadow = host.attachShadow({ mode: 'open' })
    root.appendChild(host)
    new TabSearchOverlay(host, shadow).mount()
  }

  mountOverlay()
})()
