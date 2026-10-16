/** 本功能拥有的存储键；键值保持与现有浏览器数据兼容。 */
export const STORAGE_KEYS = {
  autoCloseSettings: 'linkdeck:auto-close:settings',
  autoCloseSession: 'linkdeck:auto-close:session',
  autoCloseHistory: 'linkdeck:auto-close:history',
} as const

/** 当前浏览器的闲置标签页自动关闭配置，不参与收藏同步。 */
export type AutoCloseSettings = {
  enabled: boolean
  idleMinutes: number
  whitelistDomains: string[]
}

/** 一条由自动关闭功能关闭的页面记录，仅保存在本浏览器。 */
export type AutoCloseHistoryEntry = {
  url: string
  title: string
  closedAt: number
}
