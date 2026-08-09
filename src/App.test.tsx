import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { installChromeMock } from './test/chrome'

describe('LinkDeck popup', () => {
  beforeEach(() => {
    installChromeMock()
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
})

