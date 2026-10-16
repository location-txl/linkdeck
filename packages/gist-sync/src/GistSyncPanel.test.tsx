import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installChromeMock } from '@linkdeck/test-utils'
import { GistSyncPanel } from './GistSyncPanel'

describe('GistSyncPanel', () => {
  beforeEach(() => {
    installChromeMock()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('asks for a masked fine-grained token and explains the secret Gist boundary', async () => {
    render(<GistSyncPanel />)

    const token = await screen.findByLabelText('GitHub 细粒度令牌')
    expect(token).toHaveAttribute('type', 'password')
    expect(screen.getByText(/拿到链接的人仍能读取明文收藏/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 Secret Gist' })).toBeDisabled()
  })

  it('shows sync state without rendering any stored token', async () => {
    const chromeMock = installChromeMock()
    const sendMessage = vi.fn(async () => ({
      ok: true,
      state: {
        status: 'synced',
        gistUrl: 'https://gist.github.com/example/abc123',
        lastSyncedAt: '2026-08-10T02:00:00.000Z',
      },
    }))
    vi.stubGlobal('chrome', { ...chromeMock, runtime: { sendMessage } })

    render(<GistSyncPanel />)

    expect(await screen.findByText(/已同步/)).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub 细粒度令牌')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Secret Gist' })).toHaveAttribute(
      'href',
      'https://gist.github.com/example/abc123',
    )
  })
})
