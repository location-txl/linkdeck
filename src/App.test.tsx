import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { installChromeMock } from './test/chrome'
import { serializeBackup } from './data-transfer/data-transfer'

describe('LinkDeck popup', () => {
  beforeEach(() => {
    installChromeMock()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('adds and deletes a manually entered bookmark', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '默认' })
    await user.click(screen.getByRole('button', { name: '手动添加网站' }))
    await user.type(screen.getByLabelText('网站名称'), 'GitHub')
    await user.type(screen.getByLabelText('网址'), 'github.com')
    await user.click(screen.getByRole('button', { name: '加入卡组' }))

    await screen.findByText('GitHub')
    expect(screen.getByText('github.com')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑 GitHub' }))
    await user.click(screen.getByRole('button', { name: '删除' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => {
      expect(screen.getByText('这一组还是空的')).toBeInTheDocument()
    })
  })

  it('searches every group by title or URL and restores the active group when cleared', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '默认' })
    await addBookmark(user, 'GitHub Docs', 'https://docs.github.com/guides')

    await user.click(screen.getByRole('button', { name: '新建分组' }))
    await user.type(screen.getByLabelText('分组名称'), '工作')
    await user.click(screen.getByRole('button', { name: '创建分组' }))
    await screen.findByRole('heading', { name: '工作' })
    await addBookmark(user, '项目看板', 'https://linear.app/team-roadmap')

    await user.click(screen.getByRole('button', { name: /^默认/ }))
    const search = screen.getByRole('searchbox', { name: '搜索收藏' }) as HTMLInputElement

    await user.type(search, 'GITHUB')
    expect(screen.getByText('GitHub Docs')).toBeInTheDocument()
    expect(screen.getByText('默认', { selector: '.bookmark-row__group' })).toBeInTheDocument()
    expect(screen.queryByText('项目看板')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'linear.app')
    expect(screen.getByText('项目看板')).toBeInTheDocument()
    expect(screen.getByText('工作', { selector: '.bookmark-row__group' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(screen.getByRole('heading', { name: '默认' })).toBeInTheDocument()
    expect(screen.getByText('GitHub Docs')).toBeInTheDocument()
    expect(screen.queryByText('项目看板')).not.toBeInTheDocument()
  })

  it('shows a dedicated empty state when no bookmark matches', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '默认' })
    await addBookmark(user, 'GitHub Docs', 'https://docs.github.com/guides')
    await user.type(screen.getByRole('searchbox', { name: '搜索收藏' }), 'missing')

    expect(screen.getByRole('heading', { name: '没有找到匹配的网站' })).toBeInTheDocument()
  })

  it('focuses and selects the search query with Command+F', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: '默认' })
    const search = screen.getByRole('searchbox', { name: '搜索收藏' }) as HTMLInputElement
    await user.type(search, 'GitHub')

    const commandF = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      cancelable: true,
    })
    fireEvent(window, commandF)

    expect(commandF.defaultPrevented).toBe(true)
    expect(search).toHaveFocus()
    expect(search).toHaveValue('GitHub')
    expect(search.selectionStart).toBe(0)
    expect(search.selectionEnd).toBe('GitHub'.length)
  })

  it('downloads a JSON backup from data management', async () => {
    const user = userEvent.setup()
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<App />)

    await screen.findByRole('heading', { name: '默认' })
    await user.click(screen.getByRole('button', { name: '数据管理' }))
    await user.click(screen.getByRole('button', { name: /导出 JSON/ }))

    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:backup')
    expect(screen.getByText(/已导出 linkdeck-backup-/)).toBeInTheDocument()
  })

  it('previews and merges a JSON backup after an explicit mode choice', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '默认' })

    const json = serializeBackup({
      meta: {
        schemaVersion: 1,
        groups: [{ id: 'reading', name: '阅读', createdAt: 1, updatedAt: 2 }],
      },
      bookmarks: [{
        id: 'mdn',
        groupId: 'reading',
        title: 'MDN',
        url: 'https://developer.mozilla.org/',
        createdAt: 3,
        updatedAt: 4,
      }],
    })

    await user.click(screen.getByRole('button', { name: '数据管理' }))
    await user.upload(
      screen.getByLabelText('选择 JSON 备份文件'),
      new File([json], 'backup.json', { type: 'application/json' }),
    )
    expect(await screen.findByText('backup.json')).toBeInTheDocument()
    expect(screen.getByText('1 个分组 · 1 个网站')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /智能合并/ }))
    await user.click(screen.getByRole('button', { name: '开始导入' }))

    expect(await screen.findByText('已导入 1 个分组和 1 个网站。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^阅读/ }))
    expect(await screen.findByText('MDN')).toBeInTheDocument()
  })

  it('warns before replacing current data', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '默认' })

    const json = serializeBackup({
      meta: {
        schemaVersion: 1,
        groups: [{ id: 'replacement', name: '替换数据', createdAt: 1, updatedAt: 2 }],
      },
      bookmarks: [],
    })
    await user.click(screen.getByRole('button', { name: '数据管理' }))
    await user.upload(
      screen.getByLabelText('选择 JSON 备份文件'),
      new File([json], 'replace.json', { type: 'application/json' }),
    )
    await screen.findByText('replace.json')
    await user.click(screen.getByRole('radio', { name: /完整替换/ }))

    expect(screen.getByText('当前收藏会被备份内容覆盖，此操作无法撤销。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始导入' }))
    expect(await screen.findByRole('heading', { name: '替换数据' })).toBeInTheDocument()
  })

  it('keeps an invalid backup error inside data management', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: '默认' })

    await user.click(screen.getByRole('button', { name: '数据管理' }))
    await user.upload(
      screen.getByLabelText('选择 JSON 备份文件'),
      new File(['{'], 'broken.json', { type: 'application/json' }),
    )

    expect(await screen.findByText('无法解析 JSON 文件，请确认文件内容完整。')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '数据管理' })).toBeInTheDocument()
  })
})

async function addBookmark(user: ReturnType<typeof userEvent.setup>, title: string, url: string) {
  await user.click(screen.getByRole('button', { name: '手动添加网站' }))
  await user.type(screen.getByLabelText('网站名称'), title)
  await user.type(screen.getByLabelText('网址'), url)
  await user.click(screen.getByRole('button', { name: '加入卡组' }))
  await screen.findByText(title)
}
