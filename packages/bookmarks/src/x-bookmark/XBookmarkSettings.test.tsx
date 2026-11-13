import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getLocalStore, getSyncStore, installChromeMock, permissionsRequest, runtimeSendMessage } from '@linkdeck/test-utils'
import { XBookmarkSettingsPanel } from './XBookmarkSettings'
import { X_BOOKMARK_KEY, X_ORIGIN } from './messages'

beforeEach(() => { installChromeMock(); runtimeSendMessage.mockResolvedValue({ ok: true }) })
afterEach(cleanup)

describe('X 书签联动设置', () => {
  it('requests only x.com on enable and keeps the setting local', async () => {
    const user = userEvent.setup()
    render(<XBookmarkSettingsPanel />)
    const toggle = screen.getByRole('checkbox')
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(permissionsRequest).toHaveBeenCalledExactlyOnceWith({ origins: [X_ORIGIN] })
    expect(getLocalStore()[X_BOOKMARK_KEY]).toBe(true)
    expect(getSyncStore()).toEqual({})
    await user.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(getLocalStore()[X_BOOKMARK_KEY]).toBe(false)
    expect(permissionsRequest).toHaveBeenCalledTimes(1)
  })

  it('does not enable when permission is denied', async () => {
    permissionsRequest.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    render(<XBookmarkSettingsPanel />)
    const toggle = screen.getByRole('checkbox')
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('未获得 X 网站权限')
    expect(toggle).not.toBeChecked()
    expect(getLocalStore()[X_BOOKMARK_KEY]).not.toBe(true)
  })

  it('rolls back the setting when registration fails', async () => {
    runtimeSendMessage.mockResolvedValueOnce({ ok: false, error: '注册失败' })
    const user = userEvent.setup()
    render(<XBookmarkSettingsPanel />)
    const toggle = screen.getByRole('checkbox')
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('注册失败')
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(getLocalStore()[X_BOOKMARK_KEY]).toBe(false)
  })
})
