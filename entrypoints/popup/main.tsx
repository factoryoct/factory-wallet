import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../../src/popup/App'
import { LangProvider } from '../../src/popup/i18n'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </React.StrictMode>,
)
