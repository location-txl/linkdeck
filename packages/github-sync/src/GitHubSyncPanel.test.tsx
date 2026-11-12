import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock } from '@linkdeck/test-utils'
import { GitHubSyncPanel } from './GitHubSyncPanel'

describe('GitHubSyncPanel', () => {
  beforeEach(() => {
    installChromeMock()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('requires a repository and masked token before requesting a preview', async () => {
    const chromeMock = installChromeMock()
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      state: { status: 'disconnected' },
      preview: { version: 'one', repositoryName: 'example/bookmarks', local: { tags: 0, bookmarks: 1 }, remote: null },
    })
    vi.stubGlobal('chrome', { ...chromeMock, runtime: { sendMessage } })
    render(<GitHubSyncPanel state={{ status: 'disconnected' }} onStateChange={vi.fn()} />)

    const token = screen.getByLabelText('GitHub 细粒度令牌')
    expect(token).toHaveAttribute('type', 'password')
    fireEvent.change(token, { target: { value: 'temporary-token' } })
    expect(screen.getByRole('button', { name: '检查仓库' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('GitHub 私有仓库地址'), { target: { value: 'example/bookmarks' } })
    fireEvent.click(screen.getByRole('button', { name: '检查仓库' }))
    expect(await screen.findByRole('button', { name: '上传本机并启用' })).toBeEnabled()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'github-sync:preview' }))
  })

  it('lets the user disconnect while a conflict is pending', async () => {
    const chromeMock = installChromeMock()
    const state = { status: 'disconnected' }
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, state })
    const onStateChange = vi.fn()
    vi.stubGlobal('chrome', { ...chromeMock, runtime: { sendMessage } })
    render(<GitHubSyncPanel state={{
      status: 'conflict',
      repositoryUrl: 'https://github.com/example/bookmarks',
      conflictCount: 1,
    }} onStateChange={onStateChange} />)

    expect(screen.queryByLabelText('GitHub 细粒度令牌')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'example/bookmarks' })).toHaveAttribute('href', 'https://github.com/example/bookmarks')
    fireEvent.click(screen.getByRole('button', { name: '断开同步' }))
    expect(sendMessage).toHaveBeenCalledWith({ type: 'github-sync:disconnect' })
    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith(state))
  })
})
