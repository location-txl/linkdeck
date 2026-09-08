import type { TabSearchHistoryItem, TabSearchTab } from './messages'

export const MAX_VISIBLE_TAB_SEARCH_RESULTS = 50
export const MAX_VISIBLE_HISTORY_SEARCH_RESULTS = 100

type Match = {
  rank: number
  score: number
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/gu, '')
}

/** 返回连续命中或子序列命中的评分；query 的字符必须按顺序出现。 */
function subsequenceScore(query: string, value: string): number | undefined {
  const target = compact(query)
  const candidate = compact(value)
  if (!target) return 0

  let queryIndex = 0
  let firstMatch = -1
  let lastMatch = -1
  let previousMatch = -2
  let currentRun = 0
  let longestRun = 0

  for (let index = 0; index < candidate.length && queryIndex < target.length; index += 1) {
    if (candidate[index] !== target[queryIndex]) continue
    if (firstMatch === -1) firstMatch = index
    currentRun = index === previousMatch + 1 ? currentRun + 1 : 1
    longestRun = Math.max(longestRun, currentRun)
    previousMatch = index
    lastMatch = index
    queryIndex += 1
  }

  if (queryIndex !== target.length) return undefined
  const span = lastMatch - firstMatch + 1
  return longestRun * 10_000 - firstMatch * 100 - (span - target.length)
}

function titleMatch(query: string, title: string): Match | undefined {
  const normalizedTitle = normalize(title)
  if (normalizedTitle === query) return { rank: 0, score: 10_000 }
  if (normalizedTitle.startsWith(query)) return { rank: 1, score: 10_000 - normalizedTitle.length }
  const continuousIndex = normalizedTitle.indexOf(query)
  if (continuousIndex >= 0) return { rank: 2, score: 10_000 - continuousIndex * 100 - normalizedTitle.length }
  const score = subsequenceScore(query, title)
  return score === undefined ? undefined : { rank: 3, score }
}

function urlMatch(query: string, url: string): Match | undefined {
  const normalizedUrl = normalize(url)
  const continuousIndex = normalizedUrl.indexOf(query)
  if (continuousIndex >= 0) return { rank: 4, score: 10_000 - continuousIndex * 100 - normalizedUrl.length }
  const score = subsequenceScore(query, url)
  return score === undefined ? undefined : { rank: 5, score }
}

type SearchableItem = {
  title: string
  url: string
}

function getBestMatch(query: string, item: SearchableItem): Match | undefined {
  if (!query) return { rank: 6, score: 0 }
  const matches = [titleMatch(query, item.title), urlMatch(query, item.url)].filter((match): match is Match => match !== undefined)
  if (matches.length === 0) return undefined
  return matches.sort((left, right) => left.rank - right.rank || right.score - left.score)[0]
}

function searchItems<T extends SearchableItem>(
  items: T[],
  query: string,
  limit: number,
  compareTies: (left: T, right: T) => number,
): T[] {
  // 让不同结果类型共享完全一致的匹配优先级，只把业务相关的平局规则交给调用方。
  const normalizedQuery = normalize(query)
  return items
    .map((item, originalIndex) => {
      const match = getBestMatch(normalizedQuery, item)
      return match ? { item, match, originalIndex } : undefined
    })
    .filter((entry): entry is { item: T; match: Match; originalIndex: number } => entry !== undefined)
    .sort((left, right) => left.match.rank - right.match.rank
      || right.match.score - left.match.score
      || compareTies(left.item, right.item)
      || left.originalIndex - right.originalIndex)
    .slice(0, limit)
    .map(({ item }) => item)
}

/** 按 Command Palette 风格筛选并排序标签页，最多返回指定数量的结果。 */
export function searchTabs(
  tabs: TabSearchTab[],
  query: string,
  limit = MAX_VISIBLE_TAB_SEARCH_RESULTS,
): TabSearchTab[] {
  return searchItems(tabs, query, limit, (left, right) => left.index - right.index)
}

/** 筛选并排序浏览器历史记录；相同匹配等级下优先显示最近访问的页面。 */
export function searchHistory(
  history: TabSearchHistoryItem[],
  query: string,
  limit = MAX_VISIBLE_HISTORY_SEARCH_RESULTS,
): TabSearchHistoryItem[] {
  return searchItems(
    history,
    query,
    limit,
    (left, right) => (right.lastVisitTime ?? 0) - (left.lastVisitTime ?? 0),
  )
}
