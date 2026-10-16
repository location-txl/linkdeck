import { MAX_BOOKMARK_TITLE_LENGTH, UserFacingError, fallbackTitleForUrl } from '@linkdeck/shared'
import { MAX_TAG_NAME_LENGTH } from './types'

/** 校验并标准化标签名，标签名比较统一使用不区分大小写的结果。 */
export function validateTagName(input: string): string {
  const name = input.trim()
  if (!name) throw new UserFacingError('请输入标签名称。')
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new UserFacingError(`标签名称不能超过 ${MAX_TAG_NAME_LENGTH} 个字符。`)
  }
  return name
}

export function validateBookmarkTitle(input: string, normalizedUrl: string): string {
  const title = input.trim() || fallbackTitleForUrl(normalizedUrl)
  if (title.length > MAX_BOOKMARK_TITLE_LENGTH) {
    throw new UserFacingError(`网站名称不能超过 ${MAX_BOOKMARK_TITLE_LENGTH} 个字符。`)
  }
  return title
}
