import { describe, expect, it } from 'vitest'
import { searchTabs, MAX_VISIBLE_TAB_SEARCH_RESULTS } from './fuzzy-search'
import type { TabSearchTab } from './messages'

function createTab(overrides: Partial<TabSearchTab> = {}): TabSearchTab {
  return {
    id: 1,
    index: 0,
    title: '示例标签页',
    url: 'https://example.com/',
    active: false,
    pinned: false,
    ...overrides,
  }
}

describe('tab search fuzzy matching', () => {
  it('uses the expected title and URL ranking order', () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'GitHub', url: 'https://example.com/exact' }),
      createTab({ id: 2, index: 1, title: 'GitHub Docs', url: 'https://example.com/prefix' }),
      createTab({ id: 3, index: 2, title: 'Read GitHub Guide', url: 'https://example.com/continuous' }),
      createTab({ id: 4, index: 3, title: 'G-i-t-h-u-b', url: 'https://example.com/subsequence' }),
      createTab({ id: 5, index: 4, title: 'Other', url: 'https://github.com/' }),
      createTab({ id: 6, index: 5, title: 'Other', url: 'https://git-hub.com/' }),
    ]

    expect(searchTabs(tabs, 'GitHub').map((tab) => tab.id)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('normalizes case and surrounding whitespace for subsequence matches', () => {
    const tabs = [createTab({ id: 8, title: 'Android Developers', url: 'https://developer.android.com/' })]

    expect(searchTabs(tabs, '  aDoPeRs  ').map((tab) => tab.id)).toEqual([8])
  })

  it('uses the browser index as a stable tie breaker and caps results', () => {
    const tied = [
      createTab({ id: 21, index: 8, title: 'Other', url: 'https://git-hub.example/a' }),
      createTab({ id: 22, index: 2, title: 'Other', url: 'https://git-hub.example/b' }),
    ]
    const many = Array.from({ length: 500 }, (_, index) => createTab({ id: index + 100, index, title: `Tab ${index}` }))

    expect(searchTabs(tied, 'GitHub').map((tab) => tab.id)).toEqual([22, 21])
    expect(searchTabs(many, '')).toHaveLength(MAX_VISIBLE_TAB_SEARCH_RESULTS)
    expect(searchTabs(many, '').map((tab) => tab.id)).toEqual(
      many.slice(0, MAX_VISIBLE_TAB_SEARCH_RESULTS).map((tab) => tab.id),
    )
  })
})
