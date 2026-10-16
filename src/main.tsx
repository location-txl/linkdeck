import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { CloseHistoryPage } from '@linkdeck/tab-auto-close/history'
import './styles.css'

const viewParam = new URLSearchParams(window.location.search).get('view')
const view = viewParam === 'manager' ? 'manager' : 'popup'

if (viewParam === 'close-history') {
  document.documentElement.dataset.view = 'close-history'
  document.title = 'LinkDeck - 关闭历史'
} else if (view === 'manager') {
  document.documentElement.dataset.view = 'manager'
  document.title = 'LinkDeck - 全屏管理'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {viewParam === 'close-history' ? <CloseHistoryPage /> : <App view={view} />}
  </StrictMode>,
)
