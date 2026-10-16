import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { serializeBackup } from '@linkdeck/data-transfer'
import { bookmarkRepository } from '@linkdeck/bookmarks/repository'
import './styles.css'
import { installChromeMock, tabsCreate } from '@linkdeck/test-utils'
import { STORAGE_KEYS } from '@linkdeck/bookmarks'
import { STORAGE_KEYS as AUTO_CLOSE_STORAGE_KEYS } from '@linkdeck/tab-auto-close'

describe('LinkDeck popup', () => {
  beforeEach(() => installChromeMock())
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('adds an untagged bookmark and deletes it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getByRole('button', { name: '手动添加网站' }))
    await user.type(screen.getByLabelText('网站名称'), 'GitHub')
    await user.type(screen.getByLabelText('网址'), 'github.com')
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    await screen.findByText('GitHub')

    await user.click(screen.getByRole('button', { name: '编辑 GitHub' }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '删除网站' }))
    expect(await screen.findByText('这里还没有链接')).toBeInTheDocument()
  })

  it('opens the full-screen manager in a new browser tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })

    await user.click(screen.getByRole('button', { name: '全屏管理' }))

    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://linkdeck/index.html?view=manager',
    })
  })

  it('opens the close history page in a new browser tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })

    await user.click(screen.getByRole('button', { name: '关闭历史' }))

    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://linkdeck/index.html?view=close-history',
    })
  })

  it('does not show the full-screen trigger inside the manager page', async () => {
    render(<App view="manager" />)
    await screen.findByRole('heading', { name: '全部链接' })

    expect(screen.queryByRole('button', { name: '全屏管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '收藏当前页' })).not.toBeInTheDocument()
    expect(screen.getByText('LINK MANAGER')).toBeInTheDocument()
  })

  it('shows newer bookmarks first in the full list, tag filter, and search results', async () => {
    await bookmarkRepository.importSnapshot({
      meta: {
        schemaVersion: 2,
        tags: [{ id: 'work', name: '工作', pinned: false, createdAt: 1, updatedAt: 1 }],
      },
      bookmarks: [
        { id: 'old', tagIds: ['work'], title: '旧收藏', url: 'https://old.example.com', createdAt: 100, updatedAt: 100 },
        { id: 'new', tagIds: ['work'], title: '新收藏', url: 'https://new.example.com', createdAt: 300, updatedAt: 300 },
        { id: 'middle', tagIds: [], title: '中间收藏', url: 'https://middle.example.com', createdAt: 200, updatedAt: 200 },
      ],
    }, 'replace')
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })

    const getRowTitles = () => screen.getAllByRole('article').map((row) =>
      within(row).getByRole('button', { name: /^打开 / }).getAttribute('aria-label'))
    expect(getRowTitles()).toEqual(['打开 新收藏', '打开 中间收藏', '打开 旧收藏'])

    await user.click(screen.getByRole('button', { name: /工作/ }))
    expect(await screen.findByRole('heading', { name: '工作' })).toBeInTheDocument()
    expect(getRowTitles()).toEqual(['打开 新收藏', '打开 旧收藏'])

    await user.type(screen.getByRole('searchbox', { name: '搜索收藏' }), '收藏')
    expect(await screen.findByRole('heading', { name: '2 条结果' })).toBeInTheDocument()
    expect(getRowTitles()).toEqual(['打开 新收藏', '打开 旧收藏'])
  })

  it('filters by all selected tags, supports untagged links, and scopes search to the filter', async () => {
    const work = await bookmarkRepository.createTag('工作')
    const dev = await bookmarkRepository.createTag('开发')
    await bookmarkRepository.createBookmark({ title: '看板', url: 'https://linear.app', tagIds: [work.id], newTagNames: [] })
    await bookmarkRepository.createBookmark({ title: '文档', url: 'https://docs.example.com', tagIds: [work.id, dev.id], newTagNames: [] })
    await bookmarkRepository.createBookmark({ title: '无标签', url: 'https://untagged.example.com', tagIds: [], newTagNames: [] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('看板')

    await user.click(screen.getByRole('button', { name: /工作/ }))
    expect(screen.getByText('看板')).toBeInTheDocument()
    expect(screen.getByText('文档')).toBeInTheDocument()
    expect(screen.queryByText('无标签', { selector: 'strong' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /开发/ }))
    expect(screen.queryByText('看板')).not.toBeInTheDocument()
    expect(screen.getByText('文档')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: '搜索收藏' }), 'docs.example')
    expect(screen.getByText('文档')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: '搜索收藏' }))
    await user.click(screen.getByRole('button', { name: /查看全部标签/ }))
    await user.click(within(await screen.findByRole('dialog', { name: '全部标签' })).getByRole('button', { name: /无标签/ }))
    expect(screen.getByText('无标签', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText('文档')).not.toBeInTheDocument()
  })

  it('searches bookmarks by tag name with a hash prefix', async () => {
    const work = await bookmarkRepository.createTag('工作')
    const development = await bookmarkRepository.createTag('Development')
    const personal = await bookmarkRepository.createTag('个人')
    await bookmarkRepository.createBookmark({ title: '双标签收藏', url: 'https://combined.example.com', tagIds: [work.id, development.id], newTagNames: [] })
    await bookmarkRepository.createBookmark({ title: '工作收藏', url: 'https://work.example.com', tagIds: [work.id], newTagNames: [] })
    await bookmarkRepository.createBookmark({ title: '英文标签收藏', url: 'https://dev.example.com', tagIds: [development.id], newTagNames: [] })
    await bookmarkRepository.createBookmark({ title: '个人收藏', url: 'https://personal.example.com', tagIds: [personal.id], newTagNames: [] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('双标签收藏')

    const search = screen.getByRole('searchbox', { name: '搜索收藏' })
    expect(search).toHaveAttribute('placeholder', '搜索名称、网址或 #标签')

    await user.type(search, '#工')
    expect(await screen.findByRole('heading', { name: '2 条结果' })).toBeInTheDocument()
    expect(screen.getByText('双标签收藏')).toBeInTheDocument()
    expect(screen.getByText('工作收藏')).toBeInTheDocument()
    expect(screen.queryByText('英文标签收藏')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '#development')
    expect(await screen.findByRole('heading', { name: '2 条结果' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('双标签收藏')).toBeInTheDocument()
    expect(screen.getByText('英文标签收藏')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '#不存在')
    expect(await screen.findByRole('heading', { name: '0 条结果' })).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '#')
    expect(await screen.findByRole('heading', { name: '0 条结果' })).toBeInTheDocument()

    await user.clear(search)
    await user.click(within(screen.getByRole('navigation', { name: '标签筛选' })).getByRole('button', { name: /工作/ }))
    await user.type(search, '#Development')
    expect(await screen.findByRole('heading', { name: '1 条结果' })).toBeInTheDocument()
    expect(screen.getByText('双标签收藏')).toBeInTheDocument()
    expect(screen.queryByText('英文标签收藏')).not.toBeInTheDocument()
  })

  it('defaults to switching tags and uses Command or Ctrl clicks for multi-select', async () => {
    const work = await bookmarkRepository.createTag('工作')
    const dev = await bookmarkRepository.createTag('开发')
    await bookmarkRepository.createBookmark({ title: '工作链接', url: 'https://work.example.com', tagIds: [work.id], newTagNames: [] })
    await bookmarkRepository.createBookmark({ title: '开发链接', url: 'https://dev.example.com', tagIds: [dev.id], newTagNames: [] })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('工作链接')

    const filterBar = screen.getByRole('navigation', { name: '标签筛选' })
    const workButton = within(filterBar).getByRole('button', { name: /工作/ })
    const devButton = within(filterBar).getByRole('button', { name: /开发/ })
    await user.click(workButton)
    expect(await screen.findByRole('heading', { name: '工作' })).toBeInTheDocument()
    await user.click(devButton)
    expect(await screen.findByRole('heading', { name: '开发' })).toBeInTheDocument()
    await user.click(devButton)
    expect(screen.getByRole('heading', { name: '开发' })).toBeInTheDocument()

    fireEvent.click(workButton, { metaKey: true })
    expect(await screen.findByRole('heading', { name: '工作 + 开发' })).toBeInTheDocument()
    fireEvent.click(devButton, { ctrlKey: true })
    expect(await screen.findByRole('heading', { name: '工作' })).toBeInTheDocument()
    fireEvent.click(workButton, { metaKey: true })
    expect(await screen.findByRole('heading', { name: '全部链接' })).toBeInTheDocument()
  })

  it('persists the direct multi-select setting and displays the extension version', async () => {
    const work = await bookmarkRepository.createTag('工作')
    const dev = await bookmarkRepository.createTag('开发')
    await bookmarkRepository.createBookmark({ title: '组合链接', url: 'https://combined.example.com', tagIds: [work.id, dev.id], newTagNames: [] })
    const user = userEvent.setup()
    const first = render(<App />)
    await screen.findByText('组合链接')

    await user.click(screen.getByRole('button', { name: '设置' }))
    const settings = await screen.findByRole('dialog', { name: '设置' })
    expect(within(settings).getByText('v1.0.1')).toBeInTheDocument()
    await user.click(within(settings).getByRole('radio', { name: /直接多选/ }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /工作/ }))
    await user.click(screen.getByRole('button', { name: /开发/ }))
    expect(await screen.findByRole('heading', { name: '工作 + 开发' })).toBeInTheDocument()

    first.unmount()
    render(<App />)
    await screen.findByRole('heading', { name: '工作 + 开发' })
    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(await screen.findByRole('radio', { name: /直接多选/ })).toBeChecked()
  })

  it('keeps tag actions visible and filters with every tag from the popover', async () => {
    await bookmarkRepository.createTag('第一个标签')
    await bookmarkRepository.createTag('第二个标签')
    const third = await bookmarkRepository.createTag('第三个很长的标签名称')
    const fourth = await bookmarkRepository.createTag('第四个标签')
    await bookmarkRepository.createTag('第五个标签')
    await bookmarkRepository.createBookmark({
      title: '组合筛选结果',
      url: 'https://combined.example.com',
      tagIds: [third.id, fourth.id],
      newTagNames: [],
    })
    await bookmarkRepository.createBookmark({
      title: '无标签结果',
      url: 'https://untagged.example.com',
      tagIds: [],
      newTagNames: [],
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('组合筛选结果')

    const filterBar = screen.getByRole('navigation', { name: '标签筛选' })
    expect(within(filterBar).getByRole('button', { name: '新建标签' })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /第一个标签/ })).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /第二个标签/ })).toBeInTheDocument()

    const trigger = within(filterBar).getByRole('button', { name: /查看全部标签/ })
    await user.click(trigger)
    const popover = await screen.findByRole('dialog', { name: '全部标签' })
    expect(within(popover).getByRole('button', { name: /第五个标签/ })).toBeInTheDocument()

    await user.click(within(popover).getByRole('button', { name: /第三个很长的标签名称/ }))
    expect(popover).toBeInTheDocument()
    expect(within(filterBar).getByRole('button', { name: /第三个很长的标签名称/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(popover).getByRole('button', { name: /第四个标签/ }), { metaKey: true })
    expect(await screen.findByRole('heading', { name: '第三个很长的标签名称 + 第四个标签' })).toBeInTheDocument()
    expect(popover).toBeInTheDocument()

    await user.click(within(popover).getByRole('button', { name: /^全部/ }))
    expect(await screen.findByRole('heading', { name: '全部链接' })).toBeInTheDocument()
    await user.click(within(popover).getByRole('button', { name: /无标签/ }))
    expect(await screen.findByRole('heading', { name: '无标签' })).toBeInTheDocument()
    expect(screen.getByText('无标签结果')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '全部标签' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(within(filterBar).getByRole('button', { name: '新建标签' }))
    expect(await screen.findByLabelText('标签名称')).toBeInTheDocument()
  })

  it('persists the tag filter and clears it when the tag is deleted', async () => {
    const work = await bookmarkRepository.createTag('工作')
    await bookmarkRepository.createBookmark({ title: '看板', url: 'https://linear.app', tagIds: [work.id], newTagNames: [] })
    const user = userEvent.setup()
    const first = render(<App />)
    await screen.findByText('看板')
    await user.click(screen.getByRole('button', { name: /工作/ }))
    await screen.findByRole('heading', { name: '工作' })

    first.unmount()
    render(<App />)
    await screen.findByRole('heading', { name: '工作' })

    await bookmarkRepository.deleteTag(work.id)
    expect(await screen.findByRole('heading', { name: '全部链接' })).toBeInTheDocument()
  })

  it('configures automatic tab closing and normalizes whitelist domains', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })

    await user.click(screen.getByRole('button', { name: '设置' }))
    const settings = await screen.findByRole('dialog', { name: '设置' })
    const duration = within(settings).getByRole('spinbutton', { name: '闲置时间（分钟）' })
    expect(duration).toHaveValue(120)

    await user.clear(duration)
    await user.type(duration, '45')
    await user.tab()
    await user.type(within(settings).getByRole('textbox', { name: '添加白名单域名' }), 'HTTPS://Example.com/docs')
    await user.click(within(settings).getByRole('button', { name: '添加' }))
    expect(within(settings).getByText('example.com')).toBeInTheDocument()

    await user.click(within(settings).getByRole('checkbox', { name: /启用自动关闭/ }))
    expect(within(settings).getByRole('checkbox', { name: /启用自动关闭/ })).toBeChecked()
    await user.click(within(settings).getByRole('button', { name: '移除白名单 example.com' }))
    expect(within(settings).queryByText('example.com')).not.toBeInTheDocument()
  })

  it('keeps automatic close input visible when local storage rejects a save', async () => {
    const chromeMock = installChromeMock()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getByRole('button', { name: '设置' }))
    const settings = await screen.findByRole('dialog', { name: '设置' })
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('storage unavailable'))

    const domain = within(settings).getByRole('textbox', { name: '添加白名单域名' })
    await user.type(domain, 'example.com')
    await user.click(within(settings).getByRole('button', { name: '添加' }))

    expect(domain).toHaveValue('example.com')
    expect(await within(settings).findByRole('alert')).toHaveTextContent('storage unavailable')
    expect(within(settings).queryByRole('button', { name: '移除白名单 example.com' })).not.toBeInTheDocument()

    await user.click(within(settings).getByRole('button', { name: '添加' }))
    expect(domain).toHaveValue('')
    expect(within(settings).getByRole('button', { name: '移除白名单 example.com' })).toBeInTheDocument()
    expect(chromeMock.storage.local.set).toHaveBeenLastCalledWith({
      [AUTO_CLOSE_STORAGE_KEYS.autoCloseSettings]: { enabled: false, idleMinutes: 120, whitelistDomains: ['example.com'] },
    })
  })

  it('retries the same automatic close duration after a failed save', async () => {
    const chromeMock = installChromeMock()
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getByRole('button', { name: '设置' }))
    const settings = await screen.findByRole('dialog', { name: '设置' })
    const duration = within(settings).getByRole('spinbutton', { name: '闲置时间（分钟）' })
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('storage unavailable'))
    await user.clear(duration)
    await user.type(duration, '45{Enter}')
    expect(await within(settings).findByRole('alert')).toHaveTextContent('storage unavailable')
    const attempts = chromeMock.storage.local.set.mock.calls.length

    await user.keyboard('{Enter}')
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(attempts + 1)
    expect(chromeMock.storage.local.set).toHaveBeenLastCalledWith({
      [AUTO_CLOSE_STORAGE_KEYS.autoCloseSettings]: { enabled: false, idleMinutes: 45, whitelistDomains: [] },
    })
  })

  it('pins and unpins tags from the manager without closing it', async () => {
    const work = await bookmarkRepository.createTag('工作')
    await bookmarkRepository.createTag('阅读')
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getAllByRole('button', { name: '管理标签' })[0]!)
    expect(await screen.findByRole('dialog', { name: '管理标签' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '置顶 工作' }))
    expect(await screen.findByRole('button', { name: '取消置顶 工作' })).toBeInTheDocument()
    expect((await bookmarkRepository.load()).meta.tags.find((tag) => tag.id === work.id)?.pinned).toBe(true)

    await user.click(screen.getByRole('button', { name: '取消置顶 工作' }))
    expect(await screen.findByRole('button', { name: '置顶 工作' })).toBeInTheDocument()
    expect((await bookmarkRepository.load()).meta.tags.find((tag) => tag.id === work.id)?.pinned).toBe(false)
  })

  it('disables every tag mutation control while a pin request is pending', async () => {
    await bookmarkRepository.createTag('工作')
    await bookmarkRepository.createTag('阅读')
    let releasePin: () => void
    const pinPending = new Promise<void>((resolve) => { releasePin = resolve })
    vi.spyOn(bookmarkRepository, 'setTagPinned').mockImplementation(async () => pinPending)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getAllByRole('button', { name: '管理标签' })[0]!)
    const manager = await screen.findByRole('dialog', { name: '管理标签' })
    await user.click(within(manager).getByRole('button', { name: '置顶 工作' }))

    await waitFor(() => expect(within(manager).getByRole('button', { name: '置顶 工作' })).toBeDisabled())
    expect(within(manager).getByRole('button', { name: '置顶 阅读' })).toBeDisabled()
    expect(within(manager).getByRole('button', { name: '重命名 工作' })).toBeDisabled()
    expect(within(manager).getByRole('button', { name: '删除 阅读' })).toBeDisabled()
    expect(within(manager).getByRole('button', { name: '新建标签' })).toBeDisabled()
    expect(within(manager).getByRole('button', { name: '完成' })).toBeEnabled()

    releasePin!()
    await waitFor(() => expect(within(manager).getByRole('button', { name: '置顶 工作' })).toBeEnabled())
  })

  it('enables vertical scrolling for an oversized tag manager list', async () => {
    await Promise.all(Array.from({ length: 14 }, (_, index) => bookmarkRepository.createTag(`标签${index}`)))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })

    await user.click(screen.getAllByRole('button', { name: '管理标签' })[0]!)
    const manager = await screen.findByRole('dialog', { name: '管理标签' })
    const list = manager.querySelector<HTMLElement>('.tag-manager__list')

    expect(list).not.toBeNull()
    expect(getComputedStyle(list!).overflowY).toBe('auto')
    expect(getComputedStyle(list!).maxHeight).toBe('min(360px, calc(100vh - 180px))')
  })

  it('creates a draft tag from the input and shows it on the bookmark', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getByRole('button', { name: '手动添加网站' }))
    await user.type(screen.getByLabelText('网站名称'), 'MDN')
    await user.type(screen.getByLabelText('网址'), 'developer.mozilla.org')
    const tagInput = screen.getByPlaceholderText('输入或选择标签')
    await user.type(tagInput, '阅读')
    await user.keyboard('{Enter}')
    expect(screen.getByText('阅读', { selector: '.tag-input__chip' })).toBeInTheDocument()
    expect(tagInput).toHaveValue('')
    await user.type(tagInput, '开发')
    await user.keyboard('{Enter}')
    expect(screen.getByText('开发', { selector: '.tag-input__chip' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '添加网站' }))
    expect(await screen.findByText('阅读', { selector: '.bookmark-row__tag' })).toBeInTheDocument()
    expect(screen.getByText('开发', { selector: '.bookmark-row__tag' })).toBeInTheDocument()
  })

  it('does not create draft tags when the bookmark form is cancelled', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getByRole('button', { name: '手动添加网站' }))
    await user.type(screen.getByPlaceholderText('输入或选择标签'), '取消的标签')
    await user.keyboard('{Enter}')
    expect(screen.getByText('取消的标签', { selector: '.tag-input__chip' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect((await bookmarkRepository.load()).meta.tags).toEqual([])
  })

  it('focuses and selects the search query with Command+F', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    const search = screen.getByRole('searchbox', { name: '搜索收藏' }) as HTMLInputElement
    await user.type(search, 'GitHub')
    const commandF = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true })
    fireEvent(window, commandF)
    expect(commandF.defaultPrevented).toBe(true)
    expect(search).toHaveFocus()
    expect(search.selectionStart).toBe(0)
  })

  it('exports and imports a v2 JSON backup', async () => {
    const user = userEvent.setup()
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<App />)
    await screen.findByRole('heading', { name: '全部链接' })
    await user.click(screen.getByRole('button', { name: '数据管理' }))
    await user.click(screen.getByRole('button', { name: /导出 JSON/ }))
    expect(createObjectUrl).toHaveBeenCalledOnce()

    const json = serializeBackup({
      meta: { schemaVersion: 2, tags: [{ id: 'read', name: '阅读', pinned: false, createdAt: 1, updatedAt: 1 }] },
      bookmarks: [{ id: 'mdn', tagIds: ['read'], title: 'MDN', url: 'https://developer.mozilla.org/', createdAt: 2, updatedAt: 2 }],
    })
    await user.click(screen.getByRole('button', { name: '数据管理' }))
    await user.upload(screen.getByLabelText('选择 JSON 备份文件'), new File([json], 'backup.json', { type: 'application/json' }))
    expect(await screen.findByText('1 个标签 · 1 个网站')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /智能合并/ }))
    await user.click(screen.getByRole('button', { name: '开始导入' }))
    expect(await screen.findByText(/已导入 1 个标签和 1 个网站/)).toBeInTheDocument()
  })
})
