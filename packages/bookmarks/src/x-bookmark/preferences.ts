import { X_ORIGIN, X_BOOKMARK_KEY, X_BOOKMARK_REFRESH, type XBookmarkResponse } from './messages'

export async function isXBookmarkEnabled(): Promise<boolean> {
  return (await chrome.storage.local.get(X_BOOKMARK_KEY))[X_BOOKMARK_KEY] === true &&
    await chrome.permissions.contains({ origins: [X_ORIGIN] })
}

export async function setXBookmarkEnabled(enabled: boolean): Promise<void> {
  const previous = (await chrome.storage.local.get(X_BOOKMARK_KEY))[X_BOOKMARK_KEY] === true
  await chrome.storage.local.set({ [X_BOOKMARK_KEY]: enabled })
  try {
    const response = await chrome.runtime.sendMessage({ type: X_BOOKMARK_REFRESH }) as XBookmarkResponse | undefined
    if (!response?.ok) throw new Error(response?.error ?? '应用 X 收藏设置失败，请重试。')
  } catch (error) {
    await chrome.storage.local.set({ [X_BOOKMARK_KEY]: previous })
    throw error
  }
}
