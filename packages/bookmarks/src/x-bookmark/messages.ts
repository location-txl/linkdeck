export const X_ORIGIN = 'https://x.com/*'
export const X_BOOKMARK_KEY = 'linkdeck:x-bookmark:enabled'
export const X_BOOKMARK_SAVE = 'linkdeck:x-bookmark:save'
export const X_BOOKMARK_STATE = 'linkdeck:x-bookmark:state'
export const X_BOOKMARK_REFRESH = 'linkdeck:x-bookmark:refresh'
export const X_BOOKMARK_STOP = 'linkdeck:x-bookmark:stop'

export type XBookmarkResponse = { ok: true; enabled?: boolean; created?: boolean; tagsMerged?: boolean } | { ok: false; error: string }
