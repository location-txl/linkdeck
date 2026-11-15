import { registerTabGroupService } from './service'

/** 接入链接标签组的新建标签页监听。 */
export function registerTabGroupBackground(): void {
  registerTabGroupService()
}
