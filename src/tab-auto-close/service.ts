import {
  AUTO_CLOSE_ALARM_NAME,
  AUTO_CLOSE_MAX_CHECK_GAP_MS,
  clearAutoCloseSession,
  getAutoCloseSession,
  getAutoCloseSettings,
  isWhitelistedHost,
  normalizeAutoCloseSettings,
  setAutoCloseSession,
  type AutoCloseSessionState,
} from './preferences'

type AutoCloseTab = chrome.tabs.Tab

const HTTP_URL_PATTERN = /^https?:\/\//i

/** 所有标签事件共用的 FIFO 队列，避免并发检查覆盖 session storage。 */
let operationQueue = Promise.resolve()

function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = operationQueue.then(operation)
  operationQueue = next.catch((error: unknown) => {
    console.error('自动关闭闲置标签页任务失败', error)
  })
  return next
}

function isWebPage(tab: AutoCloseTab): boolean {
  return Boolean(tab.url && HTTP_URL_PATTERN.test(tab.url))
}

function getTabHostname(tab: AutoCloseTab): string | undefined {
  if (!tab.url || !isWebPage(tab)) return undefined
  try {
    return new URL(tab.url).hostname.toLocaleLowerCase().replace(/\.$/, '')
  } catch {
    return undefined
  }
}

function isProtectedTab(tab: AutoCloseTab, whitelistDomains: string[]): boolean {
  return Boolean(
    tab.active ||
    tab.pinned ||
    tab.audible ||
    !isWebPage(tab) ||
    isWhitelistedHost(getTabHostname(tab), whitelistDomains),
  )
}

function getTabId(tab: AutoCloseTab): string | undefined {
  return tab.id === undefined ? undefined : String(tab.id)
}

function copySession(state: AutoCloseSessionState): AutoCloseSessionState {
  return { lastCheckAt: state.lastCheckAt, idleSince: { ...state.idleSince } }
}

async function queryNormalTabs(): Promise<AutoCloseTab[]> {
  return chrome.tabs.query({ windowType: 'normal' })
}

function buildSessionState(
  tabs: AutoCloseTab[],
  previous: AutoCloseSessionState,
  now: number,
  whitelistDomains: string[],
  resetTimers: boolean,
): AutoCloseSessionState {
  const idleSince: Record<string, number> = {}
  tabs.forEach((tab) => {
    const tabId = getTabId(tab)
    if (!tabId || isProtectedTab(tab, whitelistDomains)) return
    idleSince[tabId] = resetTimers || previous.idleSince[tabId] === undefined
      ? now
      : previous.idleSince[tabId]!
  })
  return { lastCheckAt: now, idleSince }
}

async function writeInitialSession(now: number, whitelistDomains: string[]): Promise<void> {
  const tabs = await queryNormalTabs()
  await setAutoCloseSession(buildSessionState(tabs, { idleSince: {} }, now, whitelistDomains, true))
}

/**
 * 确保功能开启时存在每分钟闹钟，停用时清理该闹钟。
 *
 * @returns 闹钟状态同步完成后的 Promise。
 */
export async function ensureAutoCloseAlarm(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return
  const settings = await getAutoCloseSettings()
  if (!settings.enabled) {
    await chrome.alarms.clear(AUTO_CLOSE_ALARM_NAME)
    return
  }
  const alarm = await chrome.alarms.get(AUTO_CLOSE_ALARM_NAME)
  if (!alarm) {
    await chrome.alarms.create(AUTO_CLOSE_ALARM_NAME, { periodInMinutes: 1 })
  }
}

async function closeIfStillIdle(tabId: number, now: number): Promise<'closed' | 'gone' | 'kept'> {
  const settings = await getAutoCloseSettings()
  if (!settings.enabled) return 'kept'
  const tabs = await queryNormalTabs()
  const tab = tabs.find((candidate) => candidate.id === tabId)
  if (!tab || isProtectedTab(tab, settings.whitelistDomains)) return tab ? 'kept' : 'gone'

  const session = await getAutoCloseSession()
  const idleSince = session.idleSince[String(tabId)]
  if (idleSince === undefined || now - idleSince < settings.idleMinutes * 60 * 1000) return 'kept'

  try {
    await chrome.tabs.remove(tabId)
    return 'closed'
  } catch (error: unknown) {
    // 标签页可能在复核期间已经被用户关闭；其余页面继续按本轮任务处理。
    console.warn(`关闭闲置标签页 ${tabId} 失败`, error)
    return 'kept'
  }
}

async function checkAutoCloseInternal(now: number): Promise<void> {
  const settings = await getAutoCloseSettings()
  if (!settings.enabled) {
    await clearAutoCloseSession()
    return
  }

  const tabs = await queryNormalTabs()
  const previous = await getAutoCloseSession()
  const resetTimers = previous.lastCheckAt === undefined || now < previous.lastCheckAt || now - previous.lastCheckAt > AUTO_CLOSE_MAX_CHECK_GAP_MS
  if (resetTimers) {
    await setAutoCloseSession(buildSessionState(tabs, previous, now, settings.whitelistDomains, true))
    return
  }

  let session = buildSessionState(tabs, previous, now, settings.whitelistDomains, false)
  const threshold = settings.idleMinutes * 60 * 1000
  const candidates = tabs
    .filter((tab) => tab.id !== undefined && session.idleSince[String(tab.id)] !== undefined)
    .filter((tab) => now - session.idleSince[String(tab.id)!] >= threshold)
    .map((tab) => tab.id!)

  await setAutoCloseSession(session)
  for (const tabId of candidates) {
    const result = await closeIfStillIdle(tabId, now)
    if (result === 'closed' || result === 'gone') {
      const next = copySession(session)
      delete next.idleSince[String(tabId)]
      session = next
    }
  }

  // 关闭操作期间可能发生了切换、导航或新建标签页，保存前重新整理当前快照。
  const remainingTabs = await queryNormalTabs()
  await setAutoCloseSession(buildSessionState(remainingTabs, session, now, settings.whitelistDomains, false))
}

/** 执行一轮闲置检查；所有入口共用队列，避免同时读写会话态。 */
export function checkAutoCloseTabs(now = Date.now()): Promise<void> {
  return enqueue(() => checkAutoCloseInternal(now))
}

async function handleTabRemovedInternal(tabId: number): Promise<void> {
  const session = await getAutoCloseSession()
  if (session.idleSince[String(tabId)] === undefined) return
  delete session.idleSince[String(tabId)]
  await setAutoCloseSession(session)
}

async function resetTabTimerInternal(tabId: number, now: number): Promise<void> {
  const settings = await getAutoCloseSettings()
  if (!settings.enabled) return
  const tab = (await queryNormalTabs()).find((candidate) => candidate.id === tabId)
  const session = await getAutoCloseSession()
  if (!tab || isProtectedTab(tab, settings.whitelistDomains)) delete session.idleSince[String(tabId)]
  else session.idleSince[String(tabId)] = now
  // 局部重置不推进全局检查时间，让下轮检查仍能识别休眠间隔。
  await setAutoCloseSession(session)
}

async function resetAllTimersInternal(now: number): Promise<void> {
  const settings = await getAutoCloseSettings()
  if (!settings.enabled) {
    await clearAutoCloseSession()
    return
  }
  await writeInitialSession(now, settings.whitelistDomains)
}

function domainsChanged(left: string[], right: string[]): boolean {
  const rightSet = new Set(right)
  return left.length !== rightSet.size || left.some((domain) => !rightSet.has(domain))
}

async function resetAffectedTimersInternal(oldDomains: string[], now: number): Promise<void> {
  const settings = await getAutoCloseSettings()
  const previous = await getAutoCloseSession()
  if (previous.lastCheckAt === undefined) {
    await writeInitialSession(now, settings.whitelistDomains)
    return
  }
  const tabs = await queryNormalTabs()
  const next = copySession(previous)
  tabs.forEach((tab) => {
    const tabId = getTabId(tab)
    const hostname = getTabHostname(tab)
    if (!tabId || (!isWhitelistedHost(hostname, oldDomains) && !isWhitelistedHost(hostname, settings.whitelistDomains))) return
    if (isProtectedTab(tab, settings.whitelistDomains)) delete next.idleSince[tabId]
    else next.idleSince[tabId] = now
  })
  // 保留最近一次全量检查时间，避免白名单变化掩盖休眠间隔。
  await setAutoCloseSession(next)
}

/** 响应自动关闭配置变化，供 Service Worker 的统一 storage 监听调用。 */
export function handleAutoCloseStorageChange(change: chrome.storage.StorageChange | undefined, areaName: string): Promise<void> {
  if (areaName !== 'local' || !change) return Promise.resolve()
  return enqueue(async () => {
    const next = await getAutoCloseSettings()
    const previous = normalizeAutoCloseSettings(change.oldValue)
    const oldEnabled = previous.enabled
    const oldIdleMinutes = previous.idleMinutes
    const oldDomains = previous.whitelistDomains
    await ensureAutoCloseAlarm()
    if (!next.enabled) {
      await clearAutoCloseSession()
      return
    }
    if (!oldEnabled || oldIdleMinutes !== next.idleMinutes) {
      await resetAllTimersInternal(Date.now())
      return
    }
    if (domainsChanged(oldDomains, next.whitelistDomains)) await resetAffectedTimersInternal(oldDomains, Date.now())
  })
}

/** 浏览器启动时丢弃旧计时，让所有后台标签页重新开始计算。 */
export function handleAutoCloseStartup(): Promise<void> {
  return enqueue(async () => {
    await clearAutoCloseSession()
    await ensureAutoCloseAlarm()
  })
}

/**
 * 注册标签页事件和闹钟事件。
 *
 * Service Worker 每次被唤醒只注册一次；事件处理统一串行化，避免标签切换与定时检查互相覆盖。
 */
export function registerAutoCloseService(): void {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.alarms) return
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_CLOSE_ALARM_NAME) void checkAutoCloseTabs()
  })
  chrome.tabs.onCreated.addListener(() => {
    void checkAutoCloseTabs()
  })
  chrome.tabs.onActivated.addListener(() => {
    void checkAutoCloseTabs()
  })
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url !== undefined) {
      void enqueue(() => resetTabTimerInternal(tabId, Date.now()))
      return
    }
    void checkAutoCloseTabs()
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    void enqueue(() => handleTabRemovedInternal(tabId))
  })
  void ensureAutoCloseAlarm()
}
