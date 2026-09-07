import { describe, expect, it } from 'vitest'
import {
  MAX_VISIBLE_HISTORY_SEARCH_RESULTS,
  MAX_VISIBLE_TAB_SEARCH_RESULTS,
  searchHistory,
  searchTabs,
} from './fuzzy-search'
import type { TabSearchHistoryItem, TabSearchTab } from './messages'

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

function createHistory(overrides: Partial<TabSearchHistoryItem> = {}): TabSearchHistoryItem {
  return {
    id: 'history-1',
    title: '示例历史记录',
    url: 'https://example.com/',
    lastVisitTime: 1,
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

  it('searches history with the same fuzzy ranking and uses visit time as the tie breaker', () => {
    const history = [
      createHistory({ id: 'exact', title: 'GitHub', lastVisitTime: 100 }),
      createHistory({ id: 'prefix', title: 'GitHub Docs', lastVisitTime: 200 }),
      createHistory({ id: 'continuous', title: 'Read GitHub Guide', lastVisitTime: 300 }),
      createHistory({ id: 'subsequence', title: 'G-i-t-h-u-b', lastVisitTime: 400 }),
      createHistory({ id: 'url', title: 'Other', url: 'https://github.com/', lastVisitTime: 500 }),
    ]

    expect(searchHistory(history, 'GitHub').map((item) => item.id)).toEqual([
      'exact',
      'prefix',
      'continuous',
      'subsequence',
      'url',
    ])

    expect(searchHistory([
      createHistory({ id: 'older', title: 'Guide', lastVisitTime: 10 }),
      createHistory({ id: 'newer', title: 'Guide', lastVisitTime: 20 }),
    ], 'Guide').map((item) => item.id)).toEqual(['newer', 'older'])
  })

  it('orders empty history searches by most recent visit and caps visible results', () => {
    const history = Array.from({ length: 150 }, (_, index) => createHistory({
      id: String(index),
      lastVisitTime: index,
    }))

    expect(searchHistory(history, '')).toHaveLength(MAX_VISIBLE_HISTORY_SEARCH_RESULTS)
    expect(searchHistory(history, '').map((item) => item.id)).toEqual(
      history.slice(-MAX_VISIBLE_HISTORY_SEARCH_RESULTS).reverse().map((item) => item.id),
    )
  })
})
