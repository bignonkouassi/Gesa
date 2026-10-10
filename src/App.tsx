import { useCallback, useEffect, useState } from 'react'
import { StoreProvider, useStore } from './state/store'
import { Shell, type PageKey } from './components/Shell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Dashboard } from './pages/Dashboard'
import { Ventes } from './pages/Ventes'
import { Credits } from './pages/Credits'
import { Boutiques } from './pages/Boutiques'
import { Historique } from './pages/Historique'
import { Auth } from './pages/Auth'
import { Compte } from './pages/Compte'
import { PinLock } from './components/PinLock'
import { Conditions, Confidentialite, NotFound } from './pages/Infos'
import { supabaseEnabled } from './lib/repo'

const ROUTES: Record<string, PageKey> = {
  '#/': 'dashboard',
  '#/tableau-de-bord': 'dashboard',
  '#/ventes': 'ventes',
  '#/credits': 'credits',
  '#/historique': 'historique',
  '#/boutiques': 'boutiques',
  '#/compte': 'compte',
}

const INFO_ROUTES = ['#/confidentialite', '#/conditions']

function Router() {
  const { ready, user } = useStore()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Synchronise l'URL avec la page affichée (liens partageables + 404)
  const navigate = useCallback((p: PageKey) => {
    setPage(p)
    const entry = Object.entries(ROUTES).find(([, v]) => v === p)?.[0] ?? '#/'
    if (window.location.hash !== entry) window.location.hash = entry
  }, [])

  const backToDashboard = useCallback(() => {
    setHash('#/')
    window.location.hash = '#/'
    setPage('dashboard')
  }, [])

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
          <p className="text-sm text-slate-500">Chargement…</p>
        </div>
      </div>
    )
  }

  if (supabaseEnabled && !user) return <Auth />

  const validPages: PageKey[] = ['dashboard', 'ventes', 'credits', 'historique', 'boutiques', 'compte']
  const currentFromHash = ROUTES[hash]
  const isInfo = INFO_ROUTES.includes(hash)
  const is404 = hash !== '' && !currentFromHash && !isInfo

  if (is404) {
    return (
      <Shell page={page} onNavigate={navigate}>
        <NotFound onBack={backToDashboard} />
      </Shell>
    )
  }
  if (isInfo) {
    return (
      <Shell page={page} onNavigate={navigate}>
        {hash === '#/confidentialite' ? (
          <Confidentialite onBack={backToDashboard} />
        ) : (
          <Conditions onBack={backToDashboard} />
        )}
      </Shell>
    )
  }
  if (currentFromHash && currentFromHash !== page) setPage(currentFromHash)

  return (
    <Shell page={page} onNavigate={navigate}>
      {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
      {page === 'ventes' && <Ventes />}
      {page === 'credits' && <Credits />}
      {page === 'historique' && <Historique onNavigate={navigate} />}
      {page === 'boutiques' && <Boutiques />}
      {page === 'compte' && <Compte />}
      {!validPages.includes(page) && <NotFound onBack={backToDashboard} />}
    </Shell>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <Router />
        <PinLock />
      </StoreProvider>
    </ErrorBoundary>
  )
}
