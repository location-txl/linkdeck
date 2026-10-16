import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloseHistoryPage } from './CloseHistory'
import { appendAutoCloseHistory, getAutoCloseHistory } from './preferences'
import { getLocalStore, installChromeMock, tabsCreate } from '@linkdeck/test-utils'
import { STORAGE_KEYS } from './types'

const firstClosedAt = Date.UTC(2024, 0, 1, 3, 4, 5)
const secondClosedAt = Date.UTC(2024, 0, 2, 3, 4, 5)

describe('CloseHistoryPage', () => {
  beforeEach(() => {
    installChromeMock()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders entries newest first with title fallback and closed time', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    await appendAutoCloseHistory({ url: 'https://plain.example.com', title: '', closedAt: secondClosedAt })

    render(<CloseHistoryPage />)

    expect(await screen.findByRole('heading', { name: '关闭历史 · 2' })).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.site-mark')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('plain.example.com')
    expect(rows[1]).toHaveTextContent('使用指南')
    expect(rows[1]).toHaveTextContent('docs.example.com')
    expect(rows[1].querySelector('time')).toHaveAttribute('datetime', new Date(firstClosedAt).toISOString())
  })

  it('reopens an entry in a new tab without removing it from history', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    const user = userEvent.setup()

    render(<CloseHistoryPage />)
    await user.click(await screen.findByRole('listitem', { name: '打开 使用指南' }))

    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://docs.example.com/guide', active: true }))
    await expect(getAutoCloseHistory()).resolves.toHaveLength(1)
  })

  it('clears history only after confirmation', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    const user = userEvent.setup()

    render(<CloseHistoryPage />)
    await screen.findByRole('heading', { name: '关闭历史 · 1' })
    await user.click(screen.getByRole('button', { name: '清除历史' }))

    const confirmDialog = await screen.findByRole('dialog', { name: '清除关闭历史' })
    await user.click(within(confirmDialog).getByRole('button', { name: '清除历史' }))

    await waitFor(() => expect(getLocalStore()[STORAGE_KEYS.autoCloseHistory]).toBeUndefined())
    expect(await screen.findByText('暂无关闭记录')).toBeInTheDocument()
  })

  it('reloads the history when clicking refresh', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    const user = userEvent.setup()

    render(<CloseHistoryPage />)
    await screen.findByRole('heading', { name: '关闭历史 · 1' })

    await appendAutoCloseHistory({ url: 'https://later.example.com', title: '稍后关闭', closedAt: secondClosedAt })
    await user.click(screen.getByRole('button', { name: '刷新' }))

    expect(await screen.findByRole('heading', { name: '关闭历史 · 2' })).toBeInTheDocument()
  })

  it('filters entries by title or URL from the search field', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    await appendAutoCloseHistory({ url: 'https://plain.example.com', title: '', closedAt: secondClosedAt })
    const user = userEvent.setup()

    render(<CloseHistoryPage />)
    await screen.findByRole('heading', { name: '关闭历史 · 2' })

    await user.type(screen.getByRole('searchbox', { name: '搜索关闭历史' }), '指南')
    expect(screen.getByRole('heading', { name: '1 条结果' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '打开 使用指南' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: '打开 plain.example.com' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: '搜索关闭历史' }))
    await user.type(screen.getByRole('searchbox', { name: '搜索关闭历史' }), 'plain.example')
    expect(await screen.findByRole('listitem', { name: '打开 plain.example.com' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: '打开 使用指南' })).not.toBeInTheDocument()
  })

  it('shows the no-match state and restores the list after clearing the search', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    const user = userEvent.setup()

    render(<CloseHistoryPage />)
    await screen.findByRole('heading', { name: '关闭历史 · 1' })

    await user.type(screen.getByRole('searchbox', { name: '搜索关闭历史' }), '不存在的关键词')
    expect(await screen.findByText('没有找到“不存在的关键词”')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '0 条结果' })).toBeInTheDocument()

    await user.click(within(screen.getByRole('search')).getByRole('button', { name: '清除搜索' }))
    expect(await screen.findByRole('listitem', { name: '打开 使用指南' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '关闭历史 · 1' })).toBeInTheDocument()
  })

  it('shows the empty state and keeps clearing disabled without records', async () => {
    render(<CloseHistoryPage />)

    expect(await screen.findByText('暂无关闭记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除历史' })).toBeDisabled()
  })
})
