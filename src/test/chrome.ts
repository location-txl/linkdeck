import { vi } from 'vitest'
import { storageItemBytes } from '../lib/bookmark-utils'

type Store = Record<string, unknown>
type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageListener = (changes: Record<string, StorageChange>, areaName: string) => void
type ActivatedListener = (activeInfo: { tabId: number; windowId: number }) => void
type UpdatedListener = (tabId: number, changeInfo: { url?: string }, tab: { active?: boolean; url?: string }) => void
type MockTab = { id?: number; active?: boolean; windowId?: number; title?: string; url?: string }

const listeners = new Set<StorageListener>()
let syncStore: Store = {}
let localStore: Store = {}
let currentTab: MockTab = {
  id: 1,
  active: true,
  windowId: 1,
  title: 'Example',
  url: 'https://example.com/',
}

export const tabsCreate = vi.fn()
export const tabsQuery = vi.fn()
export const tabsGet = vi.fn()
export const actionSetBadgeText = vi.fn()
export const actionSetBadgeBackgroundColor = vi.fn()
export const actionSetTitle = vi.fn()
export const tabsOnActivatedListeners = new Set<ActivatedListener>()
export const tabsOnUpdatedListeners = new Set<UpdatedListener>()

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function select(store: Store, keys?: string | string[] | Record<string, unknown> | null): Store {
  if (keys === undefined || keys === null) return clone(store)
  const requested = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)

  return requested.reduce<Store>((result, key) => {
    if (key in store) result[key] = clone(store[key])
    return result
  }, {})
}

function createArea(getStore: () => Store, setStore: (next: Store) => void, areaName: string) {
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => select(getStore(), keys)),
    set: vi.fn(async (items: Store) => {
      const current = getStore()
      const changes: Record<string, StorageChange> = {}
      const next = { ...current }
      Object.entries(items).forEach(([key, value]) => {
        changes[key] = { oldValue: current[key], newValue: clone(value) }
        next[key] = clone(value)
      })
      setStore(next)
      listeners.forEach((listener) => listener(changes, areaName))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const current = getStore()
      const targets = Array.isArray(keys) ? keys : [keys]
      const changes: Record<string, StorageChange> = {}
      const next = { ...current }
      targets.forEach((key) => {
        if (key in next) {
          changes[key] = { oldValue: next[key] }
          delete next[key]
        }
      })
      setStore(next)
      listeners.forEach((listener) => listener(changes, areaName))
    }),
    getBytesInUse: vi.fn(async (keys?: string | string[] | null) => {
      return Object.entries(select(getStore(), keys)).reduce(
        (total, [key, value]) => total + storageItemBytes(key, value),
        0,
      )
    }),
  }
}

export function installChromeMock(initialSync: Store = {}) {
  listeners.clear()
  syncStore = clone(initialSync)
  localStore = {}
  tabsCreate.mockReset()
  tabsQuery.mockReset()
  tabsGet.mockReset()
  actionSetBadgeText.mockReset()
  actionSetBadgeBackgroundColor.mockReset()
  actionSetTitle.mockReset()
  tabsOnActivatedListeners.clear()
  tabsOnUpdatedListeners.clear()
  tabsCreate.mockResolvedValue(undefined)
  tabsQuery.mockImplementation(async () => [currentTab])
  tabsGet.mockImplementation(async (tabId: number) => ({ ...currentTab, id: tabId }))
  actionSetBadgeText.mockResolvedValue(undefined)
  actionSetBadgeBackgroundColor.mockResolvedValue(undefined)
  actionSetTitle.mockResolvedValue(undefined)

  const sync = createArea(
    () => syncStore,
    (next) => {
      syncStore = next
    },
    'sync',
  )
  const local = createArea(
    () => localStore,
    (next) => {
      localStore = next
    },
    'local',
  )
  const mockedChrome = {
    storage: {
      sync,
      local,
      onChanged: {
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) => listeners.delete(listener),
      },
    },
    tabs: {
      query: tabsQuery,
      create: tabsCreate,
      get: tabsGet,
      onActivated: {
        addListener: (listener: ActivatedListener) => tabsOnActivatedListeners.add(listener),
        removeListener: (listener: ActivatedListener) => tabsOnActivatedListeners.delete(listener),
      },
      onUpdated: {
        addListener: (listener: UpdatedListener) => tabsOnUpdatedListeners.add(listener),
        removeListener: (listener: UpdatedListener) => tabsOnUpdatedListeners.delete(listener),
      },
    },
    action: {
      setBadgeText: actionSetBadgeText,
      setBadgeBackgroundColor: actionSetBadgeBackgroundColor,
      setTitle: actionSetTitle,
    },
    runtime: {
      getManifest: () => ({ version: '1.0.1' }),
      getURL: (path: string) => `chrome-extension://linkdeck/${path}`,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onStartup: { addListener: vi.fn(), removeListener: vi.fn() },
      onInstalled: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((callback: () => void) => callback()),
      onClicked: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  }

  vi.stubGlobal('chrome', mockedChrome)
  return mockedChrome
}

export function setCurrentTab(tab: MockTab) {
  currentTab = tab
}

export function getSyncStore(): Store {
  return clone(syncStore)
}

export function getLocalStore(): Store {
  return clone(localStore)
}
