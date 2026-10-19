/** 在新的浏览器标签页中打开 LinkDeck 全屏管理页面。 */
export async function openManagerPage(): Promise<void> {
  const path = 'index.html?view=manager'
  const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(path, window.location.href).href
  if (typeof chrome !== 'undefined' && Boolean(chrome.tabs)) {
    await chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 在新的浏览器标签页中打开关闭历史页面。 */
export async function openCloseHistoryPage(): Promise<void> {
  const path = 'index.html?view=close-history'
  const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(path, window.location.href).href
  if (typeof chrome !== 'undefined' && Boolean(chrome.tabs)) {
    await chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
