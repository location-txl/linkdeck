import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { serializeBackup } from './data-transfer/data-transfer'
import { bookmarkRepository } from './lib/bookmark-repository'
import { installChromeMock } from './test/chrome'

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
    await user.click(within(popover).getByRole('button', { name: /第四个标签/ }))
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
