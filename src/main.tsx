import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA : service worker uniquement en production (en développement, il
// perturberait le hot-reload de Vite). Il permet d'ouvrir l'application
// hors ligne, une fois installée ou revisitée.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* échec silencieux : l'application reste utilisable en ligne */
    })
  })
}
