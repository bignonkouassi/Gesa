/**
 * Verrouillage de l'application par code PIN (4 ou 6 chiffres).
 * Le code n'est jamais stocké en clair : on garde un hachage SHA-256 salé.
 */

const PIN_KEY = 'ma-boutique-pin-v1'
const ATTEMPT_KEY = 'ma-boutique-pin-attempts-v1'
const MAX_TRIES = 5
const LOCKOUT_MS = 30_000

export type PinConfig = { hash: string; salt: string; length: 4 | 6; delayMinutes: number }

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    // Repli déterministe si WebCrypto indisponible (contexte non sécurisé)
    let h = 5381
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
    return `fb${(h >>> 0).toString(16)}`
  }
  const data = new TextEncoder().encode(text)
  return toHex(await subtle.digest('SHA-256', data))
}

function randomSalt(): string {
  const arr = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(arr)
  else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isPinFormat(pin: string, length: 4 | 6): boolean {
  return new RegExp(`^\\d{${length}}$`).test(pin)
}

export function readPinConfig(): PinConfig | null {
  try {
    const raw = localStorage.getItem(PIN_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as PinConfig
    return v.hash && v.salt && (v.length === 4 || v.length === 6) ? v : null
  } catch {
    return null
  }
}

/** Définit (ou remplace) le code PIN. */
export async function setPin(pin: string, length: 4 | 6, delayMinutes: number): Promise<void> {
  if (!isPinFormat(pin, length)) throw new Error(`Le code doit contenir ${length} chiffres.`)
  const salt = randomSalt()
  const hash = await sha256(`${salt}:${pin}`)
  localStorage.setItem(PIN_KEY, JSON.stringify({ hash, salt, length, delayMinutes } satisfies PinConfig))
}

export async function verifyPin(pin: string): Promise<boolean> {
  const cfg = readPinConfig()
  if (!cfg) return false
  return (await sha256(`${cfg.salt}:${pin}`)) === cfg.hash
}

export function clearPin(): void {
  localStorage.removeItem(PIN_KEY)
  localStorage.removeItem(ATTEMPT_KEY)
}

/** Blocage temporaire après trop de mauvais codes. */
export function pinAttempts(): { fails: number; until: number } {
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY)
    if (!raw) return { fails: 0, until: 0 }
    const v = JSON.parse(raw) as { fails: number; until: number }
    return typeof v.fails === 'number' ? v : { fails: 0, until: 0 }
  } catch {
    return { fails: 0, until: 0 }
  }
}

export function registerPinFailure(): { fails: number; until: number } {
  const prev = pinAttempts()
  const next = {
    fails: prev.fails + 1,
    until: prev.fails + 1 >= MAX_TRIES ? Date.now() + LOCKOUT_MS : 0,
  }
  localStorage.setItem(ATTEMPT_KEY, JSON.stringify(next))
  return next
}

export function clearPinFailures(): void {
  localStorage.removeItem(ATTEMPT_KEY)
}
