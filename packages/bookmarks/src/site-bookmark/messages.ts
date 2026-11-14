export const SITE_BOOKMARK_SAVE = 'linkdeck:site-bookmark:save'
export const SITE_BOOKMARK_STOP = 'linkdeck:site-bookmark:stop'

export type SiteBookmarkResponse = { ok: true; created?: boolean; tagsMerged?: boolean } | { ok: false; error: string }
