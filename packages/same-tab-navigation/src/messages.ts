import type { SameTabRule } from './types'

export const SAME_TAB_CONFIG_EVENT = 'linkdeck:same-tab:config'
export const SAME_TAB_REQUEST_EVENT = 'linkdeck:same-tab:request'
export const SAME_TAB_GET_RULE = 'same-tab-navigation:get-rule'
export const SAME_TAB_REFRESH = 'same-tab-navigation:refresh'
export const SAME_TAB_UPDATE = 'same-tab-navigation:update'

/** 后台只向页面返回当前来源域名的一条有效规则，不传递其他扩展数据。 */
export type SameTabResponse = {
  ok: boolean
  rule?: SameTabRule | null
  error?: string
}
