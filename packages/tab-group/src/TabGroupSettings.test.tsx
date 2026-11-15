import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getLocalStore, getSyncStore, installChromeMock } from '@linkdeck/test-utils'
import { STORAGE_KEYS } from './types'
import { TabGroupSettingsPanel } from './TabGroupSettings'

describe('链接标签组设置', () => {
  beforeEach(() => { installChromeMock() })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('saves the switch locally and starts disabled', async () => {
    const user = userEvent.setup()
    render(<TabGroupSettingsPanel />)
    const checkbox = await screen.findByRole('checkbox', { name: /启用链接标签组/ })
    await waitFor(() => expect(checkbox).toBeEnabled())
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    await waitFor(() => expect(getLocalStore()[STORAGE_KEYS.tabGroupSettings]).toEqual({ enabled: true }))
    expect(checkbox).toBeChecked()
    expect(getSyncStore()).toEqual({})
  })

  it('restores the saved switch and keeps it when saving fails', async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.tabGroupSettings]: { enabled: true } })
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('storage full'))
    const user = userEvent.setup()
    render(<TabGroupSettingsPanel />)
    const checkbox = await screen.findByRole('checkbox', { name: /启用链接标签组/ })
    await waitFor(() => expect(checkbox).toBeChecked())

    await user.click(checkbox)
    expect(await screen.findByRole('alert')).toHaveTextContent('storage full')
    expect(checkbox).toBeChecked()
  })
})
