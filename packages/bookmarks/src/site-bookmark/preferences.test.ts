import { beforeEach, describe, expect, it } from 'vitest'
import { getLocalStore, installChromeMock } from '@linkdeck/test-utils'
import { getSiteBookmarkSettings, setSiteBookmarkSettings } from './preferences'
import { SITE_BOOKMARK_KEY, type SiteRule } from './types'

const rule = (id: string, triggerSelector = 'button[data-testid="star"]'): SiteRule => ({
  id, domain: 'example.com', name: '示例', enabled: true, triggerSelector,
  url: { source: { kind: 'pageUrl' } }, title: { source: { kind: 'pageTitle' } },
  tagName: '示例', createdAt: 1, updatedAt: 1,
})

beforeEach(() => { installChromeMock() })

describe('站点收藏设置存储', () => {
  it('round-trips valid settings through local storage', async () => {
    await setSiteBookmarkSettings({ enabled: true, rules: [rule('r1')] })
    expect(getLocalStore()[SITE_BOOKMARK_KEY]).toMatchObject({ enabled: true, rules: [{ id: 'r1' }] })
    expect(await getSiteBookmarkSettings()).toMatchObject({ enabled: true, rules: [{ id: 'r1', domain: 'example.com' }] })
  })

  it('rejects writes whose rules would be dropped by normalization', async () => {
    const oversized = rule('r2', `a[href^="${'x'.repeat(300)}"]`)
    await expect(setSiteBookmarkSettings({ enabled: true, rules: [rule('r1'), oversized] }))
      .rejects.toThrow('选择器超过长度限制')
    // 被拒绝的写入不能落盘，避免"提示成功但规则悄悄消失"。
    expect(getLocalStore()[SITE_BOOKMARK_KEY]).toBeUndefined()
  })
})
