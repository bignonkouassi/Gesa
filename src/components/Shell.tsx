import type { ReactNode } from 'react'
import { useStore, type Scope } from '../state/store'
import { Button } from './ui'
import { NetworkStatus } from './NetworkStatus'
import { initials, useProfile } from '../lib/profile'
import { useTheme, type ThemeMode } from '../lib/theme'

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
  const shops = db.shops.filter((s) => !s.deleted_at)
  // Avant la première boutique, rien à filtrer : on masque les onglets
  if (shops.length === 0) return null
  const tabs: { key: Scope; label: string }[] = [
    { key: 'all', label: 'Toutes les boutiques' },
    ...shops.map((s) => ({ key: s.id as Scope, label: s.name })),
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

/** Logo officiel Gesa (pack design : G + pin + colis). */
export function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'
  return <img src="/icon-192.png" alt="Gesa" className={`${cls} shrink-0 rounded-xl`} />
}

/** Bascule clair / sombre (un clic inverse, le détail est dans Mon compte). */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme()
  const dark = theme === 'sombre'
  const next: ThemeMode = dark ? 'clair' : 'sombre'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      className={`inline-flex items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ${
        compact ? 'h-9 w-9' : 'h-10 w-10'
      }`}
    >
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
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
  const { toasts, dismissToast, user } = useStore()
  const [profile] = useProfile(user?.id)

  return (
    <div className="min-h-screen bg-slate-50 pb-24 lg:pb-8">
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <BrandLogo />
          <p className="text-sm font-bold leading-tight text-slate-800">Gesa</p>
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
        <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3">
          {profile.photo ? (
            <img
              src={profile.photo}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover"
            />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-black text-slate-600">
              {initials(profile.fullName, user?.email ?? '')}
            </span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-bold text-slate-700">{profile.fullName || 'Mon compte'}</p>
            <p className="truncate text-[11px] text-slate-400">{user?.email ?? ''}</p>
          </div>
          <ThemeToggle compact />
        </div>
      </aside>

      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-3 lg:hidden">
            <div className="flex items-center gap-2">
              <BrandLogo size="sm" />
              <p className="text-sm font-bold leading-tight text-slate-800">Gesa</p>
            </div>
            <ThemeToggle compact />
          </div>
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-2 px-4 pb-1 lg:hidden">
            <NetworkStatus />
          </div>
          {page !== 'compte' && (
            <div className="mx-auto max-w-5xl">
              <ShopTabs />
            </div>
          )}
        </header>

        <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>
      </div>

      {/* Navigation en bas (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
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
