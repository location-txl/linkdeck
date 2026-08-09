import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { installChromeMock } from './test/chrome'

describe('LinkDeck popup', () => {
  beforeEach(() => {
    installChromeMock()
  })

  afterEach(() => {
    cleanup()
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
})

async function addBookmark(user: ReturnType<typeof userEvent.setup>, title: string, url: string) {
  await user.click(screen.getByRole('button', { name: '手动添加网站' }))
  await user.type(screen.getByLabelText('网站名称'), title)
  await user.type(screen.getByLabelText('网址'), url)
  await user.click(screen.getByRole('button', { name: '加入卡组' }))
  await screen.findByText(title)
}
