export const SITE_BOOKMARK_KEY = 'linkdeck:site-bookmark:rules'
export const MAX_SITE_RULES = 20
export const MAX_SITE_SELECTOR_LENGTH = 300

/** URL 提取允许的来源；链接来自页面、最近的锚点或容器内元素。 */
export type UrlExtractSource =
  | { kind: 'pageUrl' }
  | { kind: 'closestLink' }
  | { kind: 'text'; selector: string }
  | { kind: 'attribute'; selector: string; attribute: string }

/** 标题提取允许的来源；标题来自页面标题或容器内元素。 */
export type TitleExtractSource =
  | { kind: 'pageTitle' }
  | { kind: 'text'; selector: string }
  | { kind: 'attribute'; selector: string; attribute: string }

/** 提取配置：来源加可选的正则后处理（有捕获组取第 1 组，否则整个匹配）。 */
export type ExtractConfig<S extends UrlExtractSource | TitleExtractSource> = {
  source: S
  pattern?: string
}

/** 一条站点收藏规则：点击命中触发选择器即收藏，从容器内提取链接和标题。 */
export type SiteRule = {
  id: string
  domain: string
  name: string
  enabled: boolean
  triggerSelector: string
  containerSelector?: string
  url: ExtractConfig<UrlExtractSource>
  title: ExtractConfig<TitleExtractSource>
  tagName: string
  createdAt: number
  updatedAt: number
}

export type SiteBookmarkSettings = {
  enabled: boolean
  rules: SiteRule[]
}
