import { XBookmarkSettingsPanel } from '@linkdeck/bookmarks/x-bookmark-settings'
import { SiteBookmarkSettingsPanel } from '@linkdeck/bookmarks/site-bookmark-settings'
import { BookmarkSettingsPanel } from '@linkdeck/bookmarks/settings'
import { isXBookmarkEnabled } from '@linkdeck/bookmarks/x-bookmark-preferences'
import { getSiteBookmarkSettings } from '@linkdeck/bookmarks/site-bookmark-preferences'
import type { TagClickMode } from '@linkdeck/bookmarks'
import { SameTabSettingsPanel } from '@linkdeck/same-tab-navigation/settings'
import { AutoCloseSettingsPanel } from '@linkdeck/tab-auto-close/settings'
import { Modal } from '@linkdeck/ui/modal'

/** 删除导航规则时仍被站点收藏规则或 X 收藏占用的域名；读取失败返回 undefined，由导航侧保留全部相关授权。 */
async function retainedNavigationDomains(): Promise<string[] | undefined> {
  const ruleDomains = await getSiteBookmarkSettings()
    .then((settings) => settings.enabled ? settings.rules.filter((rule) => rule.enabled).map(({ domain }) => domain) : [])
    .catch(() => undefined)
  if (ruleDomains === undefined) return undefined
  return await isXBookmarkEnabled().catch(() => false) ? [...ruleDomains, 'x.com'] : ruleDomains
}

export function SettingsModal({ mode, onSelectMode, onClose }: { mode: TagClickMode; onSelectMode: (mode: TagClickMode) => void; onClose: () => void }) {
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '开发版'
  return (
    <Modal title="设置" onClose={onClose}>
      <div className="settings">
        <BookmarkSettingsPanel mode={mode} onSelectMode={onSelectMode} />
        <XBookmarkSettingsPanel />
        <SiteBookmarkSettingsPanel />
        <SameTabSettingsPanel retainedDomains={retainedNavigationDomains} />
        <AutoCloseSettingsPanel />
        <section className="settings__section settings__about" aria-labelledby="settings-about-title">
          <h3 id="settings-about-title">关于</h3>
          <div><strong>LinkDeck</strong><span>v{version}</span></div>
        </section>
        <footer className="form__footer form__footer--end"><button className="button button--quiet" type="button" onClick={onClose}>完成</button></footer>
      </div>
    </Modal>
  )
}
