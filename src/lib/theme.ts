import { useEffect, useState } from 'react'

/* ------------------------------------------------------------------ */
/* Thème clair / sombre : choix manuel, « auto » suit le système.      */
/* Appliqué via data-theme sur <html> (voir index.css).                */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'clair' | 'sombre' | 'auto'

const THEME_KEY = 'ma-boutique-theme'
export const THEME_EVENT = 'mb-theme'

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'clair' || v === 'sombre' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'sombre') root.dataset.theme = 'dark'
  else if (mode === 'clair') root.dataset.theme = 'light'
  else delete root.dataset.theme
}

export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    /* stockage indisponible : le thème s'applique quand même */
  }
  applyTheme(mode)
  window.dispatchEvent(new Event(THEME_EVENT))
}

/** À appeler avant le premier rendu (main.tsx) pour éviter un flash. */
export function initTheme(): void {
  applyTheme(readTheme())
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(readTheme)
  useEffect(() => {
    const sync = () => {
      const next = readTheme()
      setMode(next)
      applyTheme(next)
    }
    window.addEventListener(THEME_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(THEME_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return [mode, (m: ThemeMode) => {
    setTheme(m)
    setMode(m)
  }]
}
