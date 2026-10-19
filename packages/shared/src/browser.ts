function hasChromeTabs(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs)
}

export async function openBookmark(url: string, background = false): Promise<void> {
  if (hasChromeTabs()) {
    await chrome.tabs.create({ url, active: !background })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
