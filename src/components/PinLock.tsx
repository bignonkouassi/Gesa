import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Button, Card } from './ui'
import { clearPinFailures, pinAttempts, readPinConfig, registerPinFailure, verifyPin } from '../lib/pin'

/**
 * Écran de verrouillage par code PIN après inactivité.
 * Se déclenche uniquement si un code PIN a été configuré dans « Mon compte ».
 */
export function PinLock() {
  const { logout, notify } = useStore()
  const cfg = readPinConfig()
  const [locked, setLocked] = useState(false)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [lockLeft, setLockLeft] = useState(0)
  const lastActivity = useRef(Date.now())
  const wasLocked = useRef(false)

  const arm = useCallback(() => {
    lastActivity.current = Date.now()
    // NB : l'activité seule ne déverrouille JAMAIS — seul le code PIN le fait.
  }, [])

  // Déverrouillage automatique quand l'utilisateur revient
  const tryUnlock = useCallback(async (value: string) => {
    const att = pinAttempts()
    if (att.until > Date.now()) return
    setBusy(true)
    try {
      if (await verifyPin(value)) {
        clearPinFailures()
        wasLocked.current = false
        lastActivity.current = Date.now()
        setLocked(false)
        setPin('')
      } else {
        const next = registerPinFailure()
        setPin('')
        if (next.until > 0) {
          setLockLeft(Math.ceil((next.until - Date.now()) / 1000))
          notify('Trop de codes erronés. Attends 30 secondes.', 'error')
        } else {
          notify('Code incorrect.', 'error')
        }
      }
    } finally {
      setBusy(false)
    }
  }, [notify])

  // Inactivité → verrouillage
  useEffect(() => {
    if (!cfg) return
    const delay = cfg.delayMinutes * 60_000
    const onActivity = () => arm()
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      window.addEventListener(ev, onActivity, { passive: true })
    }
    const id = window.setInterval(() => {
      if (!wasLocked.current && Date.now() - lastActivity.current >= delay) {
        wasLocked.current = true
        setLocked(true)
        setPin('')
      }
    }, 1000)
    return () => {
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
        window.removeEventListener(ev, onActivity)
      }
      window.clearInterval(id)
    }
  }, [cfg, arm])

  // Compte à rebours du blocage après mauvais codes
  useEffect(() => {
    if (!locked) return
    const id = window.setInterval(() => {
      const att = pinAttempts()
      setLockLeft(att.until > 0 ? Math.ceil((att.until - Date.now()) / 1000) : 0)
    }, 1000)
    return () => window.clearInterval(id)
  }, [locked])

  if (!cfg || !locked) return null

  const lockedOut = lockLeft > 0

  const onChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, cfg.length)
    setPin(digits)
    if (digits.length === cfg.length && !lockedOut) void tryUnlock(digits)
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/80 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-xs text-center">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-700 text-xl font-black text-white">
          MB
        </span>
        <p className="text-sm font-bold text-slate-800">Application verrouillée</p>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          Saisis ton code à {cfg.length} chiffres pour reprendre.
        </p>

        <input
          type="password"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          value={pin}
          disabled={lockedOut || busy}
          onChange={(e) => onChange(e.target.value)}
          className="mx-auto block w-40 rounded-xl border border-slate-300 px-3 py-3 text-center text-2xl font-black tracking-[0.5em] text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          placeholder={'•'.repeat(cfg.length)}
          aria-label={`Code à ${cfg.length} chiffres`}
        />

        {lockedOut && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            Trop de tentatives. Réessaie dans {lockLeft} s.
          </p>
        )}
        {busy && <p className="mt-3 text-xs text-slate-400">Vérification…</p>}

        <div className="mt-4 flex flex-col gap-2">
          <Button variant="ghost" className="w-full" onClick={() => void logout()}>
            Se déconnecter
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          Utile sur un téléphone partagé en boutique.
        </p>
      </Card>
    </div>
  )
}
