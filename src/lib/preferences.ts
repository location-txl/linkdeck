import { STORAGE_KEYS } from '../types'

function hasChromeLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

export async function getSelectedGroupId(): Promise<string | undefined> {
  if (hasChromeLocalStorage()) {
    const value = await chrome.storage.local.get(STORAGE_KEYS.selectedGroup)
    const selectedGroup = value[STORAGE_KEYS.selectedGroup]
    return typeof selectedGroup === 'string' ? selectedGroup : undefined
  }

  return window.localStorage.getItem(STORAGE_KEYS.selectedGroup) ?? undefined
}

export async function setSelectedGroupId(groupId: string): Promise<void> {
  if (hasChromeLocalStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEYS.selectedGroup]: groupId })
    return
  }

  window.localStorage.setItem(STORAGE_KEYS.selectedGroup, groupId)
}
