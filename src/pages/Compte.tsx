import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Button, Card, ConfirmDialog, Field, Input, SectionTitle, Select, Modal, Segmented } from '../components/ui'
import { PageActions } from '../components/Shell'
import { useTheme } from '../lib/theme'
import {
  initials,
  processPhotoFile,
  readSupabaseMetadata,
  saveProfile,
  syncProfileToSupabase,
  useProfile,
} from '../lib/profile'
import { isCommonPassword, parseOrThrow, passwordInput, passwordStrength } from '../lib/validation'
import { clearPin, isPinFormat, readPinConfig, setPin } from '../lib/pin'
import { exportAllCSV, exportAllExcel, exportAllJSON } from '../lib/exports'
import { formatDateShort } from '../lib/format'

/** Journal local des connexions récentes (aucun mot de passe stocké). */
const LOGIN_KEY = 'ma-boutique-recent-logins'

export type LoginEvent = { at: string; email: string; ok: boolean }

export function recordLogin(email: string, ok: boolean): void {
  try {
    const raw = localStorage.getItem(LOGIN_KEY)
    const list: LoginEvent[] = raw ? (JSON.parse(raw) as LoginEvent[]) : []
    list.unshift({ at: new Date().toISOString(), email, ok })
    localStorage.setItem(LOGIN_KEY, JSON.stringify(list.slice(0, 20)))
  } catch {
    /* journal best effort */
  }
}

function readLogins(): LoginEvent[] {
  try {
    const raw = localStorage.getItem(LOGIN_KEY)
    return raw ? (JSON.parse(raw) as LoginEvent[]) : []
  } catch {
    return []
  }
}

export function Compte() {
  const { user, db, mode, logout, notify } = useStore()
  const [theme, setTheme] = useTheme()
  const [profile, refreshProfile] = useProfile(user?.id)

  const [fullName, setFullName] = useState(profile.fullName)
  const [phone, setPhone] = useState(profile.phone)
  const [photo, setPhoto] = useState<string | null>(profile.photo)
  const [savingProfile, setSavingProfile] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* Pré-remplit depuis les métadonnées Supabase si aucun profil local */
  useEffect(() => {
    if (mode !== 'supabase') return
    if (profile.fullName || profile.phone) return
    let alive = true
    void readSupabaseMetadata().then((m) => {
      if (!alive) return
      if (m.fullName) setFullName(m.fullName)
      if (m.phone) setPhone(m.phone)
    })
    return () => {
      alive = false
    }
  }, [mode, profile.fullName, profile.phone])

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [pwdInfo, setPwdInfo] = useState('')

  const [pinOn, setPinOn] = useState(() => !!readPinConfig())
  const [pinLen, setPinLen] = useState<4 | 6>(() => readPinConfig()?.length ?? 6)
  const [pinDelay, setPinDelay] = useState<number>(() => readPinConfig()?.delayMinutes ?? 3)
  const [pinValue, setPinValue] = useState('')
  const [pinModal, setPinModal] = useState(false)

  const [confirmExport, setConfirmExport] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteWord, setDeleteWord] = useState('')

  const strength = passwordStrength(next)
  const logins = readLogins()

  /* ---------------- Changement de mot de passe ---------------- */
  const changePassword = async () => {
    setBusy(true)
    setPwdInfo('')
    try {
      if (current.length < 8) throw new Error('Mot de passe actuel invalide (8 caractères minimum).')
      if (current === next) throw new Error('Le nouveau mot de passe doit être différent.')
      parseOrThrow(passwordInput, next, 'Nouveau mot de passe')
      if (isCommonPassword(next)) throw new Error('Ce mot de passe est trop courant. Choisis-en un autre.')
      if (mode !== 'supabase') {
        throw new Error('Connecte-toi avec ton compte pour changer le mot de passe.')
      }
      const { changePasswordSupabase } = await import('../lib/repo')
      await changePasswordSupabase(current, next)
      setPwdInfo('Mot de passe modifié avec succès.')
      setCurrent('')
      setNext('')
      notify('Mot de passe modifié.')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur lors du changement.', 'error')
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- Code PIN ---------------- */
  const savePin = async () => {
    try {
      if (!isPinFormat(pinValue, pinLen)) throw new Error(`Le code doit contenir exactement ${pinLen} chiffres.`)
      await setPin(pinValue, pinLen, pinDelay)
      setPinOn(true)
      setPinModal(false)
      setPinValue('')
      notify('Verrouillage par code activé.')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Code PIN invalide.', 'error')
    }
  }

  const disablePin = () => {
    clearPin()
    setPinOn(false)
    notify('Verrouillage par code désactivé.')
  }

  /* ---------------- Profil (photo, nom, téléphone) ---------------- */
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    setPhotoBusy(true)
    try {
      setPhoto(await processPhotoFile(file))
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Photo invalide.', 'error')
    } finally {
      setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveUserProfile = async () => {
    setSavingProfile(true)
    try {
      saveProfile(user?.id, { fullName: fullName.trim(), phone: phone.trim(), photo })
      if (mode === 'supabase') await syncProfileToSupabase(fullName.trim(), phone.trim())
      refreshProfile()
      notify('Profil enregistré.')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Enregistrement impossible.', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  /* ---------------- Suppression du compte ---------------- */
  const deleteAccount = async () => {
    setConfirmDelete(false)
    try {
      if (deleteWord.trim().toUpperCase() !== 'SUPPRIMER') {
        notify('Tape SUPPRIMER en majuscules pour confirmer.', 'error')
        return
      }
      if (mode === 'supabase') {
        const { deleteAccountSupabase } = await import('../lib/repo')
        await deleteAccountSupabase()
      }
      localStorage.clear()
      notify('Compte supprimé. À bientôt.')
      await logout()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Suppression impossible.', 'error')
    }
  }

  return (
    <div>
      <PageActions>
        <Button variant="ghost" onClick={() => void logout()}>
          Se déconnecter
        </Button>
      </PageActions>

      <Card className="mb-4">
        <SectionTitle>Mon compte</SectionTitle>
        {/* Identité : photo + nom affiché */}
        <div className="flex items-center gap-4">
          {photo ? (
            <img
              src={photo}
              alt="Photo de profil"
              className="h-20 w-20 shrink-0 rounded-full border border-slate-200 object-cover"
            />
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-slate-200 text-xl font-black text-slate-600">
              {initials(fullName, user?.email ?? '')}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-slate-800">{fullName.trim() || 'Mon compte'}</p>
            <p className="truncate text-sm text-slate-500">{user?.email ?? '—'}</p>
            {phone.trim() && <p className="truncate text-sm text-slate-500">{phone.trim()}</p>}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Choisir une photo de profil"
          onChange={(e) => void pickPhoto(e.target.files?.[0])}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
            {photoBusy ? '…' : photo ? 'Changer la photo' : 'Ajouter une photo'}
          </Button>
          {photo && (
            <Button variant="ghost" onClick={() => setPhoto(null)}>
              Retirer la photo
            </Button>
          )}
        </div>
        {/* Informations du compte */}
        <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-slate-500">Boutiques</dt>
            <dd className="font-medium text-slate-800">{db.shops.filter((s) => !s.deleted_at).length}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">Ventes enregistrées</dt>
            <dd className="font-medium text-slate-800">{db.sales.length}</dd>
          </div>
        </dl>
        {/* Modification : nom et téléphone */}
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Field label="Nom et prénom">
            <Input
              type="text"
              autoComplete="name"
              maxLength={80}
              placeholder="Ex. Awa Kouassi"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label="Numéro de téléphone" hint="Visible uniquement par toi, sur cet appareil.">
            <Input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={30}
              placeholder="Ex. +225 07 00 00 00 00"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button disabled={savingProfile || photoBusy} onClick={() => void saveUserProfile()}>
            {savingProfile ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </Card>

      {/* Apparence : clair / sombre */}
      <Card className="mb-4">
        <SectionTitle>Apparence</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'clair', label: 'Clair' },
              { value: 'sombre', label: 'Sombre' },
              { value: 'auto', label: 'Auto' },
            ]}
          />
          <p className="text-xs text-slate-500">
            {theme === 'auto' ? 'Suit le réglage de ton téléphone ou ordinateur.' : `Mode ${theme} actif.`}
          </p>
        </div>
      </Card>

      {/* Changement de mot de passe */}
      <Card className="mb-4">
        <SectionTitle>Changer le mot de passe</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mot de passe actuel">
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="Nouveau mot de passe" hint="8 caractères minimum.">
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
        </div>
        {next.length > 0 && (
          <div className="mt-2">
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
              {isCommonPassword(next) && ' · trop courant'}
            </p>
          </div>
        )}
        {pwdInfo && <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{pwdInfo}</p>}
        <div className="mt-3">
          <Button disabled={busy || !current || next.length < 8} onClick={() => void changePassword()}>
            {busy ? 'Envoi…' : 'Modifier le mot de passe'}
          </Button>
        </div>
      </Card>

      {/* Verrouillage PIN */}
      <Card className="mb-4">
        <SectionTitle
          action={
            pinOn ? (
              <Button variant="secondary" onClick={disablePin}>
                Désactiver
              </Button>
            ) : undefined
          }
        >
          Verrouillage par code PIN
        </SectionTitle>
        <p className="text-sm text-slate-600">
          {pinOn
            ? `Actif : code à ${readPinConfig()?.length ?? 6} chiffres après ${readPinConfig()?.delayMinutes ?? 3} min d'inactivité.`
            : 'Utile sur un téléphone partagé en boutique : l’application se verrouille après quelques minutes d’inactivité.'}
        </p>
        {!pinOn && (
          <div className="mt-3">
            <Button onClick={() => setPinModal(true)}>Définir un code PIN</Button>
          </div>
        )}
      </Card>

      {/* Connexions récentes */}
      <Card className="mb-4">
        <SectionTitle>Connexions récentes</SectionTitle>
        {logins.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune connexion enregistrée sur cet appareil.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {logins.slice(0, 8).map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate text-slate-700">{l.email}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatDateShort(l.at.slice(0, 10))} · {l.at.slice(11, 16)} ·{' '}
                  <span className={l.ok ? 'text-emerald-600' : 'text-red-600'}>
                    {l.ok ? 'réussie' : 'échouée'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Export global */}
      <Card className="mb-4">
        <SectionTitle>Exporter toutes mes données</SectionTitle>
        <p className="text-sm text-slate-600">
          Boutiques, articles, ventes, crédits, clients et historique : ta propre copie de sécurité.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => exportAllExcel(db)}>Excel (.xlsx)</Button>
          <Button variant="secondary" onClick={() => exportAllCSV(db)}>
            CSV
          </Button>
          <Button variant="secondary" onClick={() => exportAllJSON(db)}>
            JSON (sauvegarde complète)
          </Button>
        </div>
      </Card>

      {/* Suppression du compte */}
      <Card className="border-red-100">
        <SectionTitle>Zone dangereuse</SectionTitle>
        <p className="text-sm text-slate-600">
          La suppression efface définitivement les données du compte. Cette action est irréversible : exporte d’abord
          tes données.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConfirmExport(true)}>
            Exporter avant de supprimer
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Supprimer mon compte
          </Button>
        </div>
      </Card>

      {/* Modale code PIN */}
      <Modal open={pinModal} title="Définir un code PIN" onClose={() => setPinModal(false)}>
        <div className="space-y-3">
          <Field label="Longueur du code">
            <Select value={String(pinLen)} onChange={(e) => setPinLen(e.target.value === '4' ? 4 : 6)}>
              <option value="4">4 chiffres</option>
              <option value="6">6 chiffres</option>
            </Select>
          </Field>
          <Field label="Verrouillage après">
            <Select value={String(pinDelay)} onChange={(e) => setPinDelay(Number(e.target.value))}>
              <option value="1">1 minute d’inactivité</option>
              <option value="3">3 minutes d’inactivité</option>
              <option value="5">5 minutes d’inactivité</option>
              <option value="10">10 minutes d’inactivité</option>
            </Select>
          </Field>
          <Field label="Nouveau code" hint={`${pinLen} chiffres`}>
            <Input
              type="password"
              inputMode="numeric"
              value={pinValue}
              maxLength={pinLen}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, pinLen))}
              className="text-center text-xl tracking-[0.4em]"
              placeholder={'•'.repeat(pinLen)}
            />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!isPinFormat(pinValue, pinLen)} onClick={() => void savePin()}>
              Activer
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setPinModal(false)}>
              Annuler
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmExport}
        title="Exporter les données"
        message="Télécharger Excel, CSV ou JSON ? Tu pourras choisir dans la page, ou je lance l’export Excel maintenant."
        confirmLabel="Excel maintenant"
        onConfirm={() => {
          exportAllExcel(db)
          setConfirmExport(false)
        }}
        onCancel={() => setConfirmExport(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer définitivement le compte ?"
        message="Toutes les boutiques, ventes, crédits et clients seront supprimés. Tape SUPPRIMER ci-dessous pour confirmer."
        confirmLabel="Supprimer"
        onConfirm={() => void deleteAccount()}
        onCancel={() => setConfirmDelete(false)}
      />
      {confirmDelete && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[70] flex justify-center px-4">
          <input
            className="pointer-events-auto w-full max-w-xs rounded-xl border border-red-300 bg-white px-3 py-2 text-center text-sm font-bold uppercase text-red-700 outline-none focus:ring-2 focus:ring-red-200"
            placeholder="Tape SUPPRIMER"
            value={deleteWord}
            onChange={(e) => setDeleteWord(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}
