import { useEffect, useState } from 'react'
import { z } from 'zod'
import { parseOrThrow, phoneText } from './validation'

/* ------------------------------------------------------------------ */
/* Profil utilisateur : nom, téléphone, photo.                         */
/* Stocké dans le navigateur (par compte) ; nom et téléphone sont      */
/* aussi recopiés dans les métadonnées Supabase quand c'est possible.  */
/* ------------------------------------------------------------------ */

export interface UserProfile {
  fullName: string
  phone: string
  /** Photo réduite (data URL JPEG), ou null sans photo */
  photo: string | null
}

const PROFILE_KEY_PREFIX = 'ma-boutique-profile-'
const PENDING_PREFIX = 'ma-boutique-profile-pending-'
export const PROFILE_EVENT = 'mb-profile'

const photoDataUrl = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp);base64,/, 'Photo invalide.')
  .max(700_000, 'Photo trop lourde.')

export const profileInput = z.object({
  fullName: z.string().trim().max(80, '80 caractères maximum.').default(''),
  phone: phoneText,
  photo: photoDataUrl.nullable(),
})

export function profileKey(userId: string | null | undefined): string {
  return PROFILE_KEY_PREFIX + (userId ?? 'local')
}

export function emptyProfile(): UserProfile {
  return { fullName: '', phone: '', photo: null }
}

export function readProfile(userId: string | null | undefined): UserProfile {
  try {
    const raw = localStorage.getItem(profileKey(userId))
    if (!raw) return emptyProfile()
    const parsed = profileInput.safeParse(JSON.parse(raw) as unknown)
    if (!parsed.success) return emptyProfile()
    return { fullName: parsed.data.fullName, phone: parsed.data.phone, photo: parsed.data.photo }
  } catch {
    return emptyProfile()
  }
}

export function saveProfile(userId: string | null | undefined, profile: UserProfile): UserProfile {
  const clean = parseOrThrow(profileInput, profile, 'Profil')
  const next: UserProfile = { fullName: clean.fullName, phone: clean.phone, photo: clean.photo }
  try {
    localStorage.setItem(profileKey(userId), JSON.stringify(next))
  } catch {
    throw new Error('Stockage local plein : choisis une photo plus petite ou retire-la.')
  }
  window.dispatchEvent(new Event(PROFILE_EVENT))
  return next
}

/** Initiales pour l'avatar : nom prénom, sinon début de l'e-mail. */
export function initials(fullName: string, email: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const first = parts[0][0]
    const last = parts[parts.length - 1][0]
    if (first && last) return (first + last).toUpperCase()
  }
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
  const local = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '')
  return (local.slice(0, 2) || '??').toUpperCase()
}

/** Réduit une image à 256 px max et la renvoie en JPEG (data URL). */
export function processPhotoFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('Choisis un fichier image (JPG, PNG ou WebP).'))
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error('Image trop lourde (8 Mo maximum).'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Image illisible.'))
      img.onload = () => {
        const max = 256
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** Recopie nom/téléphone dans les métadonnées Supabase (best effort). */
export async function syncProfileToSupabase(fullName: string, phone: string): Promise<void> {
  try {
    const { getSupabase, supabaseEnabled } = await import('./repo')
    if (!supabaseEnabled) return
    const sb = getSupabase()
    const { error } = (await sb?.auth.updateUser({
      data: { full_name: fullName || null, phone: phone || null },
    })) ?? {}
    if (error) throw error
  } catch {
    /* la copie distante est secondaire : le profil local fait foi */
  }
}

/** Métadonnées Supabase existantes, pour pré-remplir (best effort). */
export async function readSupabaseMetadata(): Promise<{ fullName: string; phone: string }> {
  try {
    const { getSupabase, supabaseEnabled } = await import('./repo')
    if (!supabaseEnabled) return { fullName: '', phone: '' }
    const { data } = (await getSupabase()?.auth.getUser()) ?? {}
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>
    return {
      fullName: typeof meta.full_name === 'string' ? meta.full_name : '',
      phone: typeof meta.phone === 'string' ? meta.phone : '',
    }
  } catch {
    return { fullName: '', phone: '' }
  }
}

/** Profil saisi à l'inscription, en attente de la première connexion. */
export function savePendingProfile(email: string, fullName: string): void {
  try {
    const clean = parseOrThrow(profileInput, { fullName, phone: '', photo: null }, 'Profil')
    localStorage.setItem(
      PENDING_PREFIX + email.trim().toLowerCase(),
      JSON.stringify({ fullName: clean.fullName, phone: '', photo: null }),
    )
  } catch {
    /* best effort : le profil pourra être saisi dans Mon compte */
  }
}

/** Reprend puis efface le profil en attente pour cet e-mail. */
export function takePendingProfile(email: string): UserProfile | null {
  const key = PENDING_PREFIX + email.trim().toLowerCase()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    localStorage.removeItem(key)
    const parsed = profileInput.safeParse(JSON.parse(raw) as unknown)
    if (!parsed.success) return null
    return { fullName: parsed.data.fullName, phone: parsed.data.phone, photo: parsed.data.photo }
  } catch {
    return null
  }
}

/**
 * Garantit un profil local à la première entrée : reprend la saisie
 * d'inscription, sinon les métadonnées Supabase. Le profil existant
 * n'est jamais écrasé.
 */
export async function ensureUserProfile(auth: { id: string; email: string }): Promise<void> {
  try {
    const cur = readProfile(auth.id)
    if (cur.fullName || cur.phone || cur.photo) return
    const pending = takePendingProfile(auth.email)
    if (pending && (pending.fullName || pending.phone)) {
      try {
        saveProfile(auth.id, pending)
      } catch {
        /* stockage plein : on laisse le profil vide */
      }
      return
    }
    const meta = await readSupabaseMetadata()
    if (meta.fullName || meta.phone) {
      try {
        saveProfile(auth.id, { fullName: meta.fullName, phone: meta.phone, photo: null })
      } catch {
        /* stockage plein : on laisse le profil vide */
      }
    }
  } catch {
    /* best effort : la salutation reste générique */
  }
}

/** Profil réactif : se met à jour quand il est enregistré ailleurs. */
export function useProfile(
  userId: string | null | undefined,
): [UserProfile, () => void] {
  const [profile, setProfile] = useState<UserProfile>(() => readProfile(userId))
  useEffect(() => {
    setProfile(readProfile(userId))
    const sync = () => setProfile(readProfile(userId))
    window.addEventListener(PROFILE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PROFILE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [userId])
  return [profile, () => setProfile(readProfile(userId))]
}
