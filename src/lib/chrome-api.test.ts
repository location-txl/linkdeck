import { beforeEach, describe, expect, it } from 'vitest'
import { getCurrentPageDraft, openBookmark } from './chrome-api'
import { installChromeMock, setCurrentTab, tabsCreate } from '../test/chrome'

describe('Chrome tab integration', () => {
  beforeEach(() => {
    installChromeMock()
    setCurrentTab({
      title: 'Example documentation',
      url: 'https://example.com/docs?private=1',
    })
  })

  it('pre-fills a draft from the active page', async () => {
    await expect(getCurrentPageDraft('group-1')).resolves.toEqual({
      title: 'Example documentation',
      url: 'https://example.com/docs?private=1',
      groupId: 'group-1',
    })
  })

  it('opens normal clicks in foreground and modifier clicks in background', async () => {
    await openBookmark('https://example.com', false)
    await openBookmark('https://example.com', true)

    expect(tabsCreate).toHaveBeenNthCalledWith(1, {
      url: 'https://example.com',
      active: true,
    })
    expect(tabsCreate).toHaveBeenNthCalledWith(2, {
      url: 'https://example.com',
      active: false,
    })
  })
})

