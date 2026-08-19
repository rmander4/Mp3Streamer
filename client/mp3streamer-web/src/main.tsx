import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PlayerProvider } from './player/PlayerContext.tsx'
import { ThemeProvider } from './theme/ThemeContext.tsx'
import { HistoryProvider } from './history/HistoryContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HistoryProvider>
        <PlayerProvider>
          <App />
        </PlayerProvider>
      </HistoryProvider>
    </ThemeProvider>
  </StrictMode>,
)
