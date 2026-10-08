import type { ReactNode } from 'react'
import { useStore, type Scope } from '../state/store'
import { Button } from './ui'
import { NetworkStatus } from './NetworkStatus'

export type PageKey = 'dashboard' | 'ventes' | 'credits' | 'historique' | 'boutiques' | 'compte'

const NAV: { key: PageKey; label: string; short: string; icon: ReactNode }[] = [
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    short: 'Bord',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12h7V4H3v8Zm0 8h7v-6H3v6Zm11 0h7v-10h-7v10Zm0-18v6h7V2h-7Z" />
      </svg>
    ),
  },
  {
    key: 'ventes',
    label: 'Ventes',
    short: 'Ventes',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13 5.4 5M7 13l-2 4h14" />
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="17" cy="20" r="1.5" />
      </svg>
    ),
  },
  {
    key: 'credits',
    label: 'Crédits',
    short: 'Crédits',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
  {
    key: 'historique',
    label: 'Historique',
    short: 'Hist.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3.05 11a9 9 0 1 1 .5 4" />
        <path d="M3 20v-5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    key: 'boutiques',
    label: 'Boutiques',
    short: 'Boutiq.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 9 4.5 4h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6" />
      </svg>
    ),
  },
  {
    key: 'compte',
    label: 'Mon compte',
    short: 'Compte',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
]

function ShopTabs() {
  const { db, scope, setScope } = useStore()
  const tabs: { key: Scope; label: string }[] = [
    { key: 'all', label: 'Toutes les boutiques' },
    ...db.shops.filter((s) => !s.deleted_at).map((s) => ({ key: s.id as Scope, label: s.name })),
  ]
  return (
    <div className="overflow-x-auto px-4 py-2">
      <div className="flex min-w-max gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setScope(t.key)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              scope === t.key
                ? 'bg-emerald-700 text-white shadow'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Shell({
  page,
  onNavigate,
  children,
}: {
  page: PageKey
  onNavigate: (p: PageKey) => void
  children: ReactNode
}) {
  const { toasts, dismissToast, mode } = useStore()

  return (
    <div className="min-h-screen bg-slate-50 pb-24 lg:pb-8">
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-sm font-black text-white">
            MB
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-slate-800">Ma Boutique</p>
            <p className="text-[11px] text-slate-400">
              {mode === 'supabase' ? 'Synchronisé' : 'Hors ligne'}
            </p>
          </div>
        </div>
        <div className="px-4 pb-2">
          <NetworkStatus />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => onNavigate(n.key)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                page === n.key
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <p className="px-4 py-4 text-[11px] text-slate-400">Devise : FCFA</p>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-3 lg:hidden">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-700 text-sm font-black text-white">
                MB
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold text-slate-800">Ma Boutique</p>
                <p className="text-[11px] text-slate-400">
                  {mode === 'supabase' ? 'Synchronisé (Supabase)' : 'Hors ligne (navigateur)'}
                </p>
              </div>
            </div>
          </div>
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 pb-1 lg:hidden">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Boutiques</span>
            <NetworkStatus />
          </div>
          <div className="mx-auto max-w-5xl">
            <ShopTabs />
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>
      </div>

      {/* Navigation en bas (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-5xl grid-cols-6">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => onNavigate(n.key)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition ${
                page === n.key ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {n.icon}
              {n.short}
            </button>
          ))}
        </div>
      </nav>

      {/* Notifications */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismissToast(t.id)}
            className={`pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${
              t.kind === 'error'
                ? 'bg-red-600 text-white'
                : t.kind === 'warn'
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-900 text-white'
            }`}
          >
            {t.text}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap gap-2">{children}</div>
}

export { Button }
