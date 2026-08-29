import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { TabSearchMessage, TabSearchResponse, TabSearchTab } from './messages'

const HOST_ID = 'linkdeck-tab-search-root'

function createTab(overrides: Partial<TabSearchTab> = {}): TabSearchTab {
  return {
    id: 1,
    index: 0,
    title: 'GitHub',
    url: 'https://github.com/',
    active: true,
    pinned: false,
    ...overrides,
  }
}

async function loadOverlay(tabs: TabSearchTab[]) {
  const sendMessage = vi.fn(async (message: TabSearchMessage): Promise<TabSearchResponse> => {
    if (message.type === 'tab-search:get-tabs') return { ok: true, tabs }
    return { ok: true }
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  await import('./content')

  const host = document.getElementById(HOST_ID)
  expect(host?.shadowRoot).toBeTruthy()
  await waitFor(() => expect(host?.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(Math.min(tabs.length, 50)))
  return { host: host!, shadow: host!.shadowRoot!, sendMessage }
}

describe('tab search overlay', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.getElementById(HOST_ID)?.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mounts one Shadow DOM overlay, focuses the search field, and caps visible rows', async () => {
    const tabs = Array.from({ length: 60 }, (_, index) => createTab({ id: index + 1, index, title: `Tab ${index}` }))
    const { host, shadow } = await loadOverlay(tabs)
    const input = shadow.querySelector('input')

    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1)
    expect(shadow.querySelectorAll('[role="option"]')).toHaveLength(50)
    expect(shadow.activeElement).toBe(input)
    expect(host.shadowRoot).toBe(shadow)
  })

  it('keeps the outside click target transparent without dimming the page', async () => {
    const { shadow } = await loadOverlay([createTab()])
    const styleText = shadow.querySelector('style')?.textContent ?? ''
    const backdropRule = styleText.match(/\.tab-search__backdrop \{([\s\S]*?)\}/)?.[1] ?? ''

    expect(backdropRule).toContain('background: transparent;')
    expect(backdropRule).not.toContain('rgba(22, 19, 15, 0.48)')
  })

  it('filters with fuzzy matching and opens the selected tab after closing first', async () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: 'GitHub', url: 'https://github.com/' }),
      createTab({ id: 2, index: 1, title: 'Android Developers', url: 'https://developer.android.com/' }),
    ]
    const { shadow, sendMessage } = await loadOverlay(tabs)
    const input = shadow.querySelector('input') as HTMLInputElement
    const overlayStateAtActivation: boolean[] = []
    sendMessage.mockImplementation(async (message: TabSearchMessage): Promise<TabSearchResponse> => {
      if (message.type === 'tab-search:get-tabs') return { ok: true, tabs }
      overlayStateAtActivation.push(document.getElementById(HOST_ID) !== null)
      return { ok: true }
    })

    input.value = 'gthb'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(shadow.querySelector('[role="option"] .tab-search__name')?.textContent).toBe('GitHub')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith({ type: 'tab-search:activate-tab', tabId: 1 }))
    expect(overlayStateAtActivation).toEqual([false])
    expect(document.getElementById(HOST_ID)).toBeNull()
  })

  it('supports arrow navigation and Escape close', async () => {
    const tabs = [
      createTab({ id: 1, index: 0, title: '第一个', url: 'https://one.example' }),
      createTab({ id: 2, index: 1, title: '第二个', url: 'https://two.example', active: false }),
    ]
    const { shadow } = await loadOverlay(tabs)
    const input = shadow.querySelector('input') as HTMLInputElement

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(shadow.querySelectorAll('[role="option"]')[1]).toHaveAttribute('aria-selected', 'true')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.getElementById(HOST_ID)).toBeNull()
  })

  it('refreshes an existing host instead of mounting a second overlay', async () => {
    const tabs = [createTab()]
    const { sendMessage } = await loadOverlay(tabs)
    const callsBeforeRepeat = sendMessage.mock.calls.length

    vi.resetModules()
    await import('./content')
    await waitFor(() => expect(sendMessage.mock.calls.length).toBeGreaterThan(callsBeforeRepeat))

    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1)
  })
})
