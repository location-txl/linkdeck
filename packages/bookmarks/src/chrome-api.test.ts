import { beforeEach, describe, expect, it } from 'vitest'
import { getCurrentPageDraft } from './chrome-api'
import { openBookmark } from '@linkdeck/shared/browser'
import { installChromeMock, setCurrentTab, tabsCreate } from '@linkdeck/test-utils'

describe('Chrome tab integration', () => {
  beforeEach(() => {
    installChromeMock()
    setCurrentTab({
      title: 'Example documentation',
      url: 'https://example.com/docs?private=1',
    })
  })

  it('pre-fills a draft from the active page', async () => {
    await expect(getCurrentPageDraft()).resolves.toEqual({
      title: 'Example documentation',
      url: 'https://example.com/docs?private=1',
      tagIds: [],
      newTagNames: [],
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
