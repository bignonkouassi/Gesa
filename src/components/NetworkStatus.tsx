import { useEffect, useState } from 'react'

/**
 * Indicateur de connexion : « En ligne » ou « Hors ligne ».
 * En mode Supabase, le compteur d'opérations en attente est ajouté
 * (file d'attente hors ligne avec nouvel essai automatique).
 */
export function NetworkStatus({ pending = 0 }: { pending?: number }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // Nouvel essai automatique : on re-teste la connexion toutes les 15 s hors ligne
  useEffect(() => {
    if (online) return
    const id = window.setInterval(() => {
      setChecking(true)
      setOnline(navigator.onLine)
      setChecking(false)
    }, 15000)
    return () => window.clearInterval(id)
  }, [online])

  if (online && pending === 0) return null

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        online ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-amber-500' : 'bg-red-500'}`} />
      {online
        ? pending > 0
          ? `${pending} en attente d’envoi`
          : checking
            ? 'Connexion…'
            : ''
        : `Hors ligne${pending > 0 ? ` : ${pending} en attente d’envoi` : ''}`}
    </span>
  )
}
