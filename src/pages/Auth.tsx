import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Button, Card, Field, Input } from '../components/ui'
import { BrandLogo } from '../components/Shell'
import { emailInput, firstNameInput, isCommonPassword, lastNameInput, parseOrThrow, passwordInput, passwordStrength } from '../lib/validation'
import { savePendingProfile } from '../lib/profile'
import { recordLogin } from './Compte'

/** Blocage temporaire après plusieurs échecs (anti force brute côté client) */
const MAX_ATTEMPTS = 5
const LOCK_SECONDS = 60
const STORAGE_KEY = 'ma-boutique-login-attempts'

function readAttempts(): { fails: number; until: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { fails: 0, until: 0 }
    const v = JSON.parse(raw) as { fails: number; until: number }
    return typeof v.fails === 'number' ? v : { fails: 0, until: 0 }
  } catch {
    return { fails: 0, until: 0 }
  }
}

function writeAttempts(v: { fails: number; until: number }): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
}

export function Auth() {
  const { signIn, signUp, resetPassword, notify } = useStore()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')
  const [lockLeft, setLockLeft] = useState(0)
  const attemptsRef = useRef(readAttempts())

  // Compte à rebours du blocage temporaire
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((attemptsRef.current.until - Date.now()) / 1000))
      setLockLeft(left)
      if (left === 0 && attemptsRef.current.fails > 0) {
        attemptsRef.current = { fails: 0, until: 0 }
        writeAttempts(attemptsRef.current)
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  const strength = passwordStrength(password)
  const locked = lockLeft > 0

  const registerFailure = () => {
    attemptsRef.current = {
      fails: attemptsRef.current.fails + 1,
      until:
        attemptsRef.current.fails + 1 >= MAX_ATTEMPTS ? Date.now() + LOCK_SECONDS * 1000 : 0,
    }
    writeAttempts(attemptsRef.current)
    if (attemptsRef.current.until > 0) notify(`Trop de tentatives : connexion bloquée ${LOCK_SECONDS} s.`, 'error')
  }

  const submit = async () => {
    if (locked) return
    setBusy(true)
    setInfo('')
    try {
      parseOrThrow(emailInput, email, 'E-mail')
      if (mode === 'signup') {
        parseOrThrow(passwordInput, password, 'Mot de passe')
        const cleanFirst = parseOrThrow(firstNameInput, first, 'Prénom')
        const cleanLast = parseOrThrow(lastNameInput, last, 'Nom')
        const fullName = `${cleanFirst} ${cleanLast}`.trim().replace(/\s+/g, ' ')
        const msg = await signUp(email.trim(), password, fullName)
        // Le nom est déjà enregistré : la salutation reconnaîtra l'utilisateur dès sa première entrée
        savePendingProfile(email.trim(), fullName)
        if (msg) setInfo(msg)
        else notify(`Compte créé, bienvenue ${cleanFirst} !`)
      } else {
        if (password.length < 8) throw new Error('E-mail ou mot de passe incorrect.')
        await signIn(email.trim(), password)
        attemptsRef.current = { fails: 0, until: 0 }
        writeAttempts(attemptsRef.current)
        recordLogin(email.trim(), true)
        notify('Bienvenue !')
      }
    } catch (e) {
      registerFailure()
      if (mode === 'login') recordLogin(email.trim() || '—', false)
      notify(e instanceof Error ? e.message : 'Erreur de connexion', 'error')
    } finally {
      setBusy(false)
    }
  }

  const sendResetLink = async () => {
    try {
      parseOrThrow(emailInput, email, 'E-mail')
      const msg = await resetPassword(email.trim())
      setInfo(msg)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Adresse e-mail invalide', 'error')
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <BrandLogo />
          <div>
            <p className="text-sm font-bold text-slate-800">Gesa</p>
            <p className="text-xs text-slate-500">Gestion de stock multi-boutiques</p>
          </div>
        </div>

        <div className="mb-4 flex rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-lg py-1.5 ${mode === 'login' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'}`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`flex-1 rounded-lg py-1.5 ${mode === 'signup' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'}`}
          >
            Créer un compte
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'signup' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom">
                <Input
                  type="text"
                  autoComplete="given-name"
                  maxLength={40}
                  value={first}
                  onChange={(e) => setFirst(e.target.value)}
                  placeholder="Ex. Awa"
                />
              </Field>
              <Field label="Nom">
                <Input
                  type="text"
                  autoComplete="family-name"
                  maxLength={40}
                  value={last}
                  onChange={(e) => setLast(e.target.value)}
                  placeholder="Ex. Kouassi"
                />
              </Field>
            </div>
          )}
          <Field label="E-mail">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="toi@exemple.com"
            />
          </Field>
          <Field label="Mot de passe" hint={mode === 'signup' ? '8 caractères minimum.' : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          {mode === 'signup' && password.length > 0 && (
            <div>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      i < strength.score
                        ? strength.score <= 1
                          ? 'bg-red-400'
                          : strength.score === 2
                            ? 'bg-amber-400'
                            : 'bg-emerald-500'
                        : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Robustesse : <b>{strength.label}</b>
                {isCommonPassword(password) && ' · mot de passe trop courant'}
              </p>
            </div>
          )}

          {locked && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              Trop de tentatives. Réessaie dans {lockLeft} s.
            </p>
          )}

          {info && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{info}</p>}

          <Button
            className="w-full"
            disabled={
              busy ||
              locked ||
              !email ||
              (mode === 'signup' ? password.length < 8 || !first.trim() : password.length < 1)
            }
            onClick={submit}
          >
            {busy ? 'Vérification…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </Button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => void sendResetLink()}
              className="w-full text-center text-xs font-semibold text-emerald-700 hover:underline"
            >
              Mot de passe oublié ?
            </button>
          )}

          <p className="text-center text-xs text-slate-400">
            Chaque compte ne voit que ses propres boutiques (sécurité appliquée en base).
          </p>
          <div className="flex justify-center gap-3 text-[11px] text-slate-400">
            <a href="#/confidentialite" className="hover:underline">
              Confidentialité
            </a>
            <a href="#/conditions" className="hover:underline">
              Conditions
            </a>
          </div>
        </div>
      </Card>
    </div>
  )
}
