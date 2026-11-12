import { BookmarksPage } from '@linkdeck/bookmarks/page'
import { DataTransferModal } from '@linkdeck/data-transfer/ui'
import { GitHubSyncPanel } from '@linkdeck/github-sync/ui'
import { GitHubSyncStatus } from '@linkdeck/github-sync/status'
import { useGitHubSyncState } from '@linkdeck/github-sync/use-state'
import { openCloseHistoryPage, openManagerPage } from './navigation'
import { SettingsModal } from './SettingsModal'

export default function App({ view = 'popup' }: { view?: 'popup' | 'manager' }) {
  const { state, setState } = useGitHubSyncState()
  return (
    <BookmarksPage
      view={view}
      syncStatus={<GitHubSyncStatus state={state} />}
      onOpenManager={() => void openManagerPage()}
      onOpenCloseHistory={() => void openCloseHistoryPage()}
      renderSettings={(props) => <SettingsModal {...props} />}
      renderDataManager={(props) => (
        <DataTransferModal {...props} syncPanel={<GitHubSyncPanel state={state} onStateChange={setState} />} />
      )}
    />
  )
}
