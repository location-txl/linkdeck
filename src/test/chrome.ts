import { vi } from 'vitest'
import { storageItemBytes } from '../lib/bookmark-utils'

type Store = Record<string, unknown>
type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageListener = (changes: Record<string, StorageChange>, areaName: string) => void
type ActivatedListener = (activeInfo: { tabId: number; windowId: number }) => void
type UpdatedListener = (tabId: number, changeInfo: { url?: string }, tab: { active?: boolean; url?: string }) => void
type MockTab = { id?: number; active?: boolean; pinned?: boolean; audible?: boolean; windowId?: number; title?: string; url?: string }
type CommandListener = (command: string, tab?: MockTab) => void
type CreatedListener = (tab: MockTab) => void
type RemovedListener = (tabId: number, removeInfo: { windowId: number; isWindowClosing: boolean }) => void
type AlarmListener = (alarm: { name: string; periodInMinutes?: number; scheduledTime: number }) => void

const listeners = new Set<StorageListener>()
let syncStore: Store = {}
let localStore: Store = {}
let sessionStore: Store = {}
let queriedTabs: MockTab[] | undefined
let alarmsStore: Record<string, { name: string; periodInMinutes?: number; scheduledTime: number }> = {}
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
export const tabsUpdate = vi.fn()
export const tabsRemove = vi.fn()
export const historySearch = vi.fn()
export const scriptingExecuteScript = vi.fn()
export const actionSetBadgeText = vi.fn()
export const actionSetBadgeBackgroundColor = vi.fn()
export const actionSetTitle = vi.fn()
export const tabsOnActivatedListeners = new Set<ActivatedListener>()
export const tabsOnUpdatedListeners = new Set<UpdatedListener>()
export const tabsOnCreatedListeners = new Set<CreatedListener>()
export const tabsOnRemovedListeners = new Set<RemovedListener>()
export const commandsOnCommandListeners = new Set<CommandListener>()
export const alarmsOnAlarmListeners = new Set<AlarmListener>()
export const alarmsCreate = vi.fn()
export const alarmsGet = vi.fn()
export const alarmsClear = vi.fn()

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
  sessionStore = {}
  queriedTabs = undefined
  alarmsStore = {}
  tabsCreate.mockReset()
  tabsQuery.mockReset()
  tabsGet.mockReset()
  tabsUpdate.mockReset()
  tabsRemove.mockReset()
  historySearch.mockReset()
  scriptingExecuteScript.mockReset()
  actionSetBadgeText.mockReset()
  actionSetBadgeBackgroundColor.mockReset()
  actionSetTitle.mockReset()
  tabsOnActivatedListeners.clear()
  tabsOnUpdatedListeners.clear()
  tabsOnCreatedListeners.clear()
  tabsOnRemovedListeners.clear()
  commandsOnCommandListeners.clear()
  alarmsOnAlarmListeners.clear()
  alarmsCreate.mockReset()
  alarmsGet.mockReset()
  alarmsClear.mockReset()
  tabsCreate.mockResolvedValue(undefined)
  tabsQuery.mockImplementation(async () => (queriedTabs ?? [currentTab]).map((tab) => ({ ...tab })))
  tabsGet.mockImplementation(async (tabId: number) => {
    const tab = (queriedTabs ?? [currentTab]).find((candidate) => candidate.id === tabId) ?? currentTab
    return { ...tab, id: tabId }
  })
  tabsUpdate.mockResolvedValue(undefined)
  tabsRemove.mockImplementation(async (tabId: number) => {
    if (queriedTabs) queriedTabs = queriedTabs.filter((tab) => tab.id !== tabId)
  })
  historySearch.mockResolvedValue([])
  scriptingExecuteScript.mockResolvedValue([])
  actionSetBadgeText.mockResolvedValue(undefined)
  actionSetBadgeBackgroundColor.mockResolvedValue(undefined)
  actionSetTitle.mockResolvedValue(undefined)
  alarmsCreate.mockImplementation(async (nameOrInfo: string | undefined | { periodInMinutes?: number }, maybeInfo?: { periodInMinutes?: number }) => {
    const name = typeof nameOrInfo === 'string' ? nameOrInfo : ''
    const info = typeof nameOrInfo === 'string' ? maybeInfo : nameOrInfo
    alarmsStore[name] = { name, periodInMinutes: info?.periodInMinutes, scheduledTime: Date.now() }
  })
  alarmsGet.mockImplementation(async (name: string) => alarmsStore[name])
  alarmsClear.mockImplementation(async (name: string) => {
    const existed = Boolean(alarmsStore[name])
    delete alarmsStore[name]
    return existed
  })

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
  const session = createArea(
    () => sessionStore,
    (next) => {
      sessionStore = next
    },
    'session',
  )
  const mockedChrome = {
    storage: {
      sync,
      local,
      session,
      onChanged: {
        addListener: (listener: StorageListener) => listeners.add(listener),
        removeListener: (listener: StorageListener) => listeners.delete(listener),
      },
    },
    tabs: {
      query: tabsQuery,
      create: tabsCreate,
      get: tabsGet,
      update: tabsUpdate,
      onActivated: {
        addListener: (listener: ActivatedListener) => tabsOnActivatedListeners.add(listener),
        removeListener: (listener: ActivatedListener) => tabsOnActivatedListeners.delete(listener),
      },
      onUpdated: {
        addListener: (listener: UpdatedListener) => tabsOnUpdatedListeners.add(listener),
        removeListener: (listener: UpdatedListener) => tabsOnUpdatedListeners.delete(listener),
      },
      onCreated: {
        addListener: (listener: CreatedListener) => tabsOnCreatedListeners.add(listener),
        removeListener: (listener: CreatedListener) => tabsOnCreatedListeners.delete(listener),
      },
      onRemoved: {
        addListener: (listener: RemovedListener) => tabsOnRemovedListeners.add(listener),
        removeListener: (listener: RemovedListener) => tabsOnRemovedListeners.delete(listener),
      },
      remove: tabsRemove,
    },
    history: {
      search: historySearch,
    },
    action: {
      setBadgeText: actionSetBadgeText,
      setBadgeBackgroundColor: actionSetBadgeBackgroundColor,
      setTitle: actionSetTitle,
    },
    alarms: {
      create: alarmsCreate,
      get: alarmsGet,
      clear: alarmsClear,
      onAlarm: {
        addListener: (listener: AlarmListener) => alarmsOnAlarmListeners.add(listener),
        removeListener: (listener: AlarmListener) => alarmsOnAlarmListeners.delete(listener),
      },
    },
    commands: {
      onCommand: {
        addListener: (listener: CommandListener) => commandsOnCommandListeners.add(listener),
        removeListener: (listener: CommandListener) => commandsOnCommandListeners.delete(listener),
      },
    },
    scripting: {
      executeScript: scriptingExecuteScript,
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

export function setTabs(tabs: MockTab[]) {
  queriedTabs = tabs.map((tab) => ({ ...tab }))
}

export function getSyncStore(): Store {
  return clone(syncStore)
}

export function getLocalStore(): Store {
  return clone(localStore)
}
