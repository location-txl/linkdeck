import { BookmarkSettingsPanel } from '@linkdeck/bookmarks/settings'
import type { TagClickMode } from '@linkdeck/bookmarks'
import { SameTabSettingsPanel } from '@linkdeck/same-tab-navigation/settings'
import { AutoCloseSettingsPanel } from '@linkdeck/tab-auto-close/settings'
import { Modal } from '@linkdeck/ui/modal'

export function SettingsModal({ mode, onSelectMode, onClose }: { mode: TagClickMode; onSelectMode: (mode: TagClickMode) => void; onClose: () => void }) {
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '开发版'
  return (
    <Modal title="设置" onClose={onClose}>
      <div className="settings">
        <BookmarkSettingsPanel mode={mode} onSelectMode={onSelectMode} />
        <SameTabSettingsPanel />
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
