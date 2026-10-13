import { createSameTabNavigation, type SameTabNavigation } from './navigation'
import { SAME_TAB_CONFIG_EVENT, SAME_TAB_REQUEST_EVENT } from './messages'
import { normalizeSameTabSettings } from './rules'

(() => {
  const host = window as Window & { __linkdeckSameTabNavigation?: SameTabNavigation }
  if (host.__linkdeckSameTabNavigation?.version !== 2) {
    host.__linkdeckSameTabNavigation?.update(null)
    host.__linkdeckSameTabNavigation?.dispose()
    const navigation = createSameTabNavigation(window)
    host.__linkdeckSameTabNavigation = navigation
    const onConfig = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail
      const settings = normalizeSameTabSettings({ enabled: true, sites: [detail] })
      navigation.update(settings.sites[0] ?? null)
    }
    window.addEventListener(SAME_TAB_CONFIG_EVENT, onConfig)
    const dispose = navigation.dispose
    navigation.dispose = () => {
      window.removeEventListener(SAME_TAB_CONFIG_EVENT, onConfig)
      dispose()
    }
  }
  window.dispatchEvent(new Event(SAME_TAB_REQUEST_EVENT))
})()
