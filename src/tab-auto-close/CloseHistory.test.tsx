import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloseHistoryModal } from './CloseHistory'
import { appendAutoCloseHistory, getAutoCloseHistory } from './preferences'
import { getLocalStore, installChromeMock, tabsCreate } from '../test/chrome'
import { STORAGE_KEYS } from '../types'

const firstClosedAt = Date.UTC(2024, 0, 1, 3, 4, 5)
const secondClosedAt = Date.UTC(2024, 0, 2, 3, 4, 5)

describe('CloseHistoryModal', () => {
  const onClose = vi.fn()

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

    render(<CloseHistoryModal onClose={onClose} />)

    const rows = await screen.findAllByRole('listitem')
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

    render(<CloseHistoryModal onClose={onClose} />)
    await user.click(await screen.findByRole('listitem', { name: '打开 使用指南' }))

    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://docs.example.com/guide', active: true }))
    await expect(getAutoCloseHistory()).resolves.toHaveLength(1)
  })

  it('clears history only after confirmation', async () => {
    await appendAutoCloseHistory({ url: 'https://docs.example.com/guide', title: '使用指南', closedAt: firstClosedAt })
    const user = userEvent.setup()

    render(<CloseHistoryModal onClose={onClose} />)
    await user.click(await screen.findByRole('button', { name: '清除历史' }))

    const confirmDialog = await screen.findByRole('dialog', { name: '清除关闭历史' })
    await user.click(within(confirmDialog).getByRole('button', { name: '清除历史' }))

    await waitFor(() => expect(getLocalStore()[STORAGE_KEYS.autoCloseHistory]).toBeUndefined())
    expect(await screen.findByText('暂无关闭记录')).toBeInTheDocument()
  })

  it('shows the empty state and keeps clearing disabled without records', async () => {
    render(<CloseHistoryModal onClose={onClose} />)

    expect(await screen.findByText('暂无关闭记录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除历史' })).toBeDisabled()
  })
})
