import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from '@/app'
import { AccountProvider, HealthProvider } from '@/lib/session'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <HealthProvider>
        <AccountProvider>
          <App />
        </AccountProvider>
      </HealthProvider>
    </BrowserRouter>
  </StrictMode>
)
