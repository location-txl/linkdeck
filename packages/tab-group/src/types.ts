/** 本功能拥有的存储键；键值保持与现有浏览器数据兼容。 */
export const STORAGE_KEYS = {
  tabGroupSettings: 'linkdeck:tab-group:settings',
} as const

/** 链接标签组配置，仅保存在当前浏览器，不参与收藏同步。 */
export type TabGroupSettings = {
  enabled: boolean
}
