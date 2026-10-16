import { BookmarksPage } from '@linkdeck/bookmarks/page'
import { DataTransferModal } from '@linkdeck/data-transfer/ui'
import { GistSyncPanel } from '@linkdeck/gist-sync/ui'
import { GistSyncStatus } from '@linkdeck/gist-sync/status'
import { useGistSyncState } from '@linkdeck/gist-sync/use-state'
import { openCloseHistoryPage, openManagerPage } from './navigation'
import { SettingsModal } from './SettingsModal'

export default function App({ view = 'popup' }: { view?: 'popup' | 'manager' }) {
  const { state, setState } = useGistSyncState()
  return (
    <BookmarksPage
      view={view}
      syncStatus={<GistSyncStatus state={state} />}
      onOpenManager={() => void openManagerPage()}
      onOpenCloseHistory={() => void openCloseHistoryPage()}
      renderSettings={(props) => <SettingsModal {...props} />}
      renderDataManager={(props) => (
        <DataTransferModal {...props} syncPanel={<GistSyncPanel onStateChange={setState} />} />
      )}
    />
  )
}
