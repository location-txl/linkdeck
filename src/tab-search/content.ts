import { searchHistory, searchTabs } from './fuzzy-search'
import type { TabSearchHistoryItem, TabSearchMessage, TabSearchResponse, TabSearchTab } from './messages'

(() => {
  const HOST_ID = 'linkdeck-tab-search-root'
  const REFRESH_EVENT = 'linkdeck:refresh'
  const GET_TABS_MESSAGE = 'tab-search:get-tabs'
  const GET_HISTORY_MESSAGE = 'tab-search:get-history'
  const ACTIVATE_TAB_MESSAGE = 'tab-search:activate-tab'
  const OPEN_HISTORY_MESSAGE = 'tab-search:open-history'
  const SEARCH_SOURCES = ['tabs', 'history'] as const
  type SearchSource = typeof SEARCH_SOURCES[number]

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

    .tab-search__time {
      display: block;
      margin-top: 3px;
      color: #9d958a;
      font-size: 9px;
      line-height: 1.25;
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
      .tab-search__time,
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

  function errorMessage(error: unknown, fallback = '读取标签页失败，请重新尝试。'): string {
    return error instanceof Error ? error.message : fallback
  }

  function isSafeFaviconUrl(value: string): boolean {
    try {
      return ['http:', 'https:', 'data:', 'chrome:', 'chrome-extension:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }

  /** 将历史记录时间转换为稳定、易读的相对时间，缺失时间时保留明确占位。 */
  function formatHistoryTime(lastVisitTime?: number): string {
    if (lastVisitTime === undefined || !Number.isFinite(lastVisitTime)) return '访问时间未知'

    const elapsed = Math.max(0, Date.now() - lastVisitTime)
    const minutes = Math.floor(elapsed / 60_000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    if (hours < 48) return '昨天'

    const days = Math.floor(hours / 24)
    if (days < 30) return `${days} 天前`

    const date = new Date(lastVisitTime)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }

  class TabSearchOverlay {
    private readonly host: HTMLDivElement
    private readonly input: HTMLInputElement
    private readonly palette: HTMLElement
    private readonly scope: HTMLDivElement
    private readonly hintLabel: HTMLSpanElement
    private readonly count: HTMLSpanElement
    private readonly results: HTMLDivElement
    private readonly empty: HTMLDivElement
    private readonly status: HTMLSpanElement
    private tabs: TabSearchTab[] = []
    private history: TabSearchHistoryItem[] = []
    private visibleTabs: TabSearchTab[] = []
    private visibleHistory: TabSearchHistoryItem[] = []
    private query = ''
    private source: SearchSource = 'tabs'
    private selectedIndex = 0
    private tabsLoading = true
    private historyLoading = false
    private error: string | undefined
    private tabsRequestVersion = 0
    private historyRequestVersion = 0
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

      this.palette = createElement('section', 'tab-search__palette')
      this.palette.setAttribute('role', 'dialog')
      this.palette.setAttribute('aria-modal', 'true')
      this.palette.setAttribute('aria-label', '搜索标签页')

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
      this.scope = createElement('div', 'tab-search__scope')
      this.scope.textContent = '当前浏览器窗口 · 输入即定位'
      brandCopy.append(eyebrow, title, this.scope)
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
        if (this.source === 'history') {
          void this.loadHistory(false)
        } else {
          this.render()
        }
      })
      this.input.addEventListener('keydown', this.handleKeyDown)
      const shortcut = createElement('span', 'tab-search__shortcut')
      shortcut.setAttribute('aria-hidden', 'true')
      const shortcutKey = createElement('kbd')
      shortcutKey.textContent = '⌘⇧P'
      shortcut.append(shortcutKey)
      field.append(glyph, this.input, shortcut)

      const hint = createElement('div', 'tab-search__hint')
      this.hintLabel = createElement('span')
      this.hintLabel.textContent = 'Tab 切换来源　·　↑ ↓ 选择　·　Enter 打开　·　Esc 关闭'
      this.count = createElement('span', 'tab-search__count')
      hint.append(this.hintLabel, this.count)

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

      this.palette.append(header, field, hint, this.results, this.empty, footer)
      layer.append(backdrop, this.palette)
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
      if (this.source === 'history') {
        void this.loadHistory(true)
      } else {
        void this.loadTabs(true)
      }
    }

    private readonly handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        const currentIndex = SEARCH_SOURCES.indexOf(this.source)
        const direction = event.shiftKey ? -1 : 1
        const nextIndex = (currentIndex + direction + SEARCH_SOURCES.length) % SEARCH_SOURCES.length
        this.switchSource(SEARCH_SOURCES[nextIndex])
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        this.close()
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const visibleItems = this.source === 'history' ? this.visibleHistory : this.visibleTabs
        if (visibleItems.length === 0) return
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        this.selectedIndex = (this.selectedIndex + direction + visibleItems.length) % visibleItems.length
        this.render()
        this.scrollSelectionIntoView()
        return
      }

      if (event.key !== 'Enter') return
      if (this.source === 'history' && this.visibleHistory[this.selectedIndex]) {
        event.preventDefault()
        void this.openHistory(this.visibleHistory[this.selectedIndex])
        return
      }

      if (this.source === 'tabs' && this.visibleTabs[this.selectedIndex]) {
        event.preventDefault()
        void this.selectTab(this.visibleTabs[this.selectedIndex])
      }
    }

    /** 切换搜索数据源并保留关键词；历史源切换时会触发一次后台查询。 */
    private switchSource(source: SearchSource): void {
      if (source === this.source) return
      this.source = source
      this.selectedIndex = 0
      this.error = undefined
      if (source === 'history') {
        void this.loadHistory(false)
      } else {
        this.historyRequestVersion += 1
        this.render()
      }
      this.focusSearch(false)
    }

    private async loadTabs(selectQuery: boolean): Promise<void> {
      const requestVersion = ++this.tabsRequestVersion
      this.tabsLoading = true
      if (this.source === 'tabs') {
        this.error = undefined
        this.render()
      }

      try {
        const message: TabSearchMessage = { type: GET_TABS_MESSAGE }
        const response = await chrome.runtime.sendMessage(message) as TabSearchResponse | undefined
        if (!response) throw new Error('读取标签页失败，请重新尝试。')
        if (!response.ok) throw new Error(response.error)
        if (!('tabs' in response)) throw new Error('标签页数据格式无效。')

        if (requestVersion !== this.tabsRequestVersion) return
        this.tabs = response.tabs
        this.tabsLoading = false
        if (this.closed || this.source !== 'tabs') return
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, searchTabs(this.tabs, this.query).length - 1))
        this.render()
        this.focusSearch(selectQuery)
      } catch (error: unknown) {
        if (this.closed || requestVersion !== this.tabsRequestVersion) return
        this.tabsLoading = false
        if (this.source !== 'tabs') return
        this.error = errorMessage(error)
        this.render()
        this.focusSearch(selectQuery)
      }
    }

    /** 查询当前关键词的浏览器历史记录，并丢弃已经过时或离开历史模式的响应。 */
    private async loadHistory(selectQuery: boolean): Promise<void> {
      const requestVersion = ++this.historyRequestVersion
      this.historyLoading = true
      this.history = []
      this.error = undefined
      this.render()

      try {
        const message: TabSearchMessage = { type: GET_HISTORY_MESSAGE, query: this.query }
        const response = await chrome.runtime.sendMessage(message) as TabSearchResponse | undefined
        if (this.closed || this.source !== 'history' || requestVersion !== this.historyRequestVersion) return
        if (!response) throw new Error('读取浏览器历史记录失败，请重新尝试。')
        if (!response.ok) throw new Error(response.error)
        if (!('history' in response)) throw new Error('浏览器历史记录数据格式无效。')

        this.history = response.history
        this.historyLoading = false
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, searchHistory(this.history, this.query).length - 1))
        this.render()
        this.focusSearch(selectQuery)
      } catch (error: unknown) {
        if (this.closed || this.source !== 'history' || requestVersion !== this.historyRequestVersion) return
        this.historyLoading = false
        this.history = []
        this.error = errorMessage(error, '读取浏览器历史记录失败，请重新尝试。')
        this.render()
        this.focusSearch(selectQuery)
      }
    }

    private render(): void {
      this.visibleTabs = searchTabs(this.tabs, this.query)
      this.visibleHistory = searchHistory(this.history, this.query)
      const isHistory = this.source === 'history'
      const visibleItems = isHistory ? this.visibleHistory : this.visibleTabs
      const sourceItems = isHistory ? this.history : this.tabs
      const loading = isHistory ? this.historyLoading : this.tabsLoading
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, visibleItems.length - 1))
      this.scope.textContent = isHistory ? '浏览器历史记录 · 最近访问' : '当前浏览器窗口 · 输入即定位'
      this.hintLabel.textContent = 'Tab 切换来源　·　↑ ↓ 选择　·　Enter 打开　·　Esc 关闭'
      this.palette.setAttribute('aria-label', isHistory ? '搜索浏览器历史记录' : '搜索标签页')
      this.input.setAttribute('aria-label', isHistory ? '搜索浏览器历史记录' : '搜索标签页')
      this.results.setAttribute('aria-label', isHistory ? '浏览器历史记录' : '当前窗口标签页')
      this.count.textContent = loading ? '读取中…' : `${visibleItems.length} / ${sourceItems.length}`
      this.status.textContent = this.error
        ? this.error
        : loading
          ? isHistory ? '正在读取浏览器历史记录…' : '正在读取标签页…'
          : isHistory ? `${this.history.length} 条历史记录` : `${this.tabs.length} 个标签页`
      this.results.textContent = ''
      this.empty.textContent = ''
      this.empty.hidden = true

      if (loading) {
        const loading = createElement('div', 'tab-search__loading')
        loading.textContent = isHistory ? '正在读取浏览器历史记录…' : '正在读取当前窗口的标签页…'
        this.results.append(loading)
        this.input.removeAttribute('aria-activedescendant')
        return
      }

      if (visibleItems.length === 0) {
        const heading = createElement('strong')
        heading.textContent = this.error
          ? isHistory ? '无法读取浏览器历史记录' : '无法读取标签页'
          : isHistory
            ? this.history.length === 0 ? '没有浏览器历史记录' : '没有找到匹配的历史记录'
            : this.tabs.length === 0 ? '当前窗口没有标签页' : '没有找到匹配的标签页'
        const description = createElement('span')
        description.textContent = this.error ?? (isHistory
          ? this.history.length === 0 ? '请稍后重新尝试。' : '试试标题、网址或连续输入几个字符。'
          : this.tabs.length === 0 ? '请打开一个网页后重新尝试。' : '试试标题、网址或连续输入几个字符.')
        this.empty.append(heading, description)
        this.empty.hidden = false
        this.input.removeAttribute('aria-activedescendant')
        return
      }

      if (isHistory) {
        this.visibleHistory.forEach((item, resultIndex) => this.appendHistoryItem(item, resultIndex))
        this.input.setAttribute('aria-activedescendant', `linkdeck-tab-search-history-option-${this.selectedIndex}`)
        return
      }

      this.visibleTabs.forEach((tab, resultIndex) => this.appendTabItem(tab, resultIndex))
      this.input.setAttribute('aria-activedescendant', `linkdeck-tab-search-option-${this.visibleTabs[this.selectedIndex].id}`)
    }

    private appendTabItem(tab: TabSearchTab, resultIndex: number): void {
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
    }

    /** 将单条历史记录渲染为可用键盘选择的列表项。 */
    private appendHistoryItem(historyItem: TabSearchHistoryItem, resultIndex: number): void {
      const item = createElement('button', 'tab-search__item')
      item.type = 'button'
      item.id = `linkdeck-tab-search-history-option-${resultIndex}`
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(resultIndex === this.selectedIndex))
      item.dataset.selected = String(resultIndex === this.selectedIndex)
      item.addEventListener('click', () => void this.openHistory(historyItem))

      const icon = createElement('span', 'tab-search__icon')
      icon.textContent = '◌'
      icon.setAttribute('aria-hidden', 'true')
      const copy = createElement('span', 'tab-search__copy')
      const nameLine = createElement('span', 'tab-search__name-line')
      const name = createElement('strong', 'tab-search__name')
      name.textContent = historyItem.title
      nameLine.append(name)
      const url = createElement('small', 'tab-search__url')
      url.textContent = historyItem.url
      const time = createElement('small', 'tab-search__time')
      time.textContent = formatHistoryTime(historyItem.lastVisitTime)
      copy.append(nameLine, url, time)

      const historyIndex = createElement('span', 'tab-search__index')
      historyIndex.textContent = String(resultIndex + 1)
      historyIndex.setAttribute('aria-hidden', 'true')
      item.append(icon, copy, historyIndex)
      this.results.append(item)
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

    private async openHistory(historyItem: TabSearchHistoryItem): Promise<void> {
      this.close()
      try {
        const message: TabSearchMessage = { type: OPEN_HISTORY_MESSAGE, url: historyItem.url }
        const response = await chrome.runtime.sendMessage(message) as TabSearchResponse | undefined
        if (response && !response.ok) console.warn('打开历史记录失败', response.error)
      } catch (error: unknown) {
        console.warn('打开历史记录失败', error)
      }
    }

    private close(): void {
      if (this.closed) return
      this.closed = true
      this.historyRequestVersion += 1
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
    // 使用 closed ShadowRoot，避免宿主网页脚本读取搜索结果中的浏览历史。
    const shadow = host.attachShadow({ mode: 'closed' })
    root.appendChild(host)
    new TabSearchOverlay(host, shadow).mount()
  }

  mountOverlay()
})()
