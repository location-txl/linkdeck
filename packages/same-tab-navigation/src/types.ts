/** 本功能拥有的存储键；键值保持与现有浏览器数据兼容。 */
export const STORAGE_KEYS = {
  sameTabSettings: 'linkdeck:same-tab:settings',
} as const

/** 指定网站内的普通导航范围，配置仅保存在当前浏览器。 */
export type SameTabRule = {
  domain: string
  scope: 'site' | 'all'
}

/** 按来源网站启用当前标签页导航，不参与收藏数据同步。 */
export type SameTabSettings = {
  enabled: boolean
  sites: SameTabRule[]
}
