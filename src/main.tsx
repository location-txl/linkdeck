import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const view = new URLSearchParams(window.location.search).get('view') === 'manager' ? 'manager' : 'popup'
if (view === 'manager') {
  document.documentElement.dataset.view = 'manager'
  document.title = 'LinkDeck - 全屏管理'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App view={view} />
  </StrictMode>,
)
