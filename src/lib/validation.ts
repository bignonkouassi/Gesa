import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Messages d'erreur en français, sans détail technique                */
/* ------------------------------------------------------------------ */

const frenchErrorMap: z.ZodErrorMap = (issue, _ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.expected === 'string' ? 'Valeur texte attendue.' : 'Valeur numérique attendue.' }
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: issue.minimum === 1 ? 'Ce champ ne peut pas être vide.' : `Saisis au moins ${issue.minimum} caractères.` }
      }
      if (issue.type === 'number') {
        return { message: issue.minimum === 1 ? 'Le nombre doit être supérieur à 0.' : `Le nombre doit être au moins ${issue.minimum}.` }
      }
      return { message: 'Valeur trop petite.' }
    case z.ZodIssueCode.too_big:
      return { message: `Valeur trop grande (maximum ${issue.maximum}).` }
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Valeur non autorisée.' }
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === 'regex' ? 'Format invalide.' : 'Format invalide.' }
    case z.ZodIssueCode.custom:
      return { message: issue.message ?? 'Valeur invalide.' }
    default:
      return { message: 'Valeur invalide.' }
  }
}

/** Valide des données et lève une erreur claire en français */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown, label = 'Formulaire'): z.infer<S> {
  const result = schema.safeParse(data, { errorMap: frenchErrorMap })
  if (!result.success) {
    const first = result.error.issues[0]
    const path = first.path.join('.')
    throw new Error(`${label} : ${first.message}${path ? ` (${path})` : ''}`)
  }
  return result.data as z.infer<S>
}

/* ------------------------------------------------------------------ */
/* Types de base                                                       */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const dateISO = z
  .string()
  .regex(DATE_RE, 'Date attendue au format jour/mois/année.')
  .refine((s) => {
    const d = new Date(`${s}T12:00:00`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'Cette date n’existe pas.')

export const dateNoFuture = dateISO.refine((s) => s <= today(), 'Pas de date future.')

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Montant en FCFA : entier, positif, plafonné à une valeur raisonnable */
export const amount = z
  .number({ invalid_type_error: 'Montant numérique attendu.' })
  .int('Le montant doit être un nombre entier en FCFA.')
  .min(0, 'Le montant ne peut pas être négatif.')
  .max(1_000_000_000, 'Montant trop élevé.')

/** Montant strictement positif, plafonné */
export const positiveAmount = z
  .number({ invalid_type_error: 'Montant numérique attendu.' })
  .int('Le montant doit être un nombre entier en FCFA.')
  .min(1, 'Le montant doit être supérieur à 0.')
  .max(1_000_000_000, 'Montant trop élevé.')

export const quantity = z
  .number({ invalid_type_error: 'Quantité numérique attendue.' })
  .int('La quantité doit être un nombre entier.')
  .min(1, 'La quantité doit être supérieure à 0.')
  .max(1_000_000, 'Quantité trop élevée.')

export const stockQty = z
  .number({ invalid_type_error: 'Stock numérique attendu.' })
  .int('Le stock doit être un nombre entier.')
  .min(0, 'Le stock ne peut pas être négatif.')
  .max(10_000_000, 'Stock trop élevé.')

export const nameText = z
  .string()
  .trim()
  .min(1, 'Ce champ ne peut pas être vide.')
  .max(80, '80 caractères maximum.')

export const phoneText = z
  .string()
  .trim()
  .max(30, '30 caractères maximum.')
  .refine((v) => v === '' || (/^[+0-9 ().-]+$/.test(v) && (v.match(/\d/g) || []).length >= 6), 'Numéro de téléphone invalide.')

/* ------------------------------------------------------------------ */
/* Schémas métier                                                      */
/* ------------------------------------------------------------------ */

export const shopInput = z.object({ name: nameText.max(60, '60 caractères maximum.') })

export const itemInput = z.object({
  name: nameText,
  cost: amount.max(100_000_000, 'Prix d’achat trop élevé.'),
  price: amount.max(100_000_000, 'Prix de vente trop élevé.'),
  stock: z
    .number({ invalid_type_error: 'Stock numérique attendu.' })
    .int('Le stock doit être un nombre entier.')
    .min(0, 'Le stock ne peut pas être négatif.')
    .max(10_000_000, 'Stock trop élevé.'),
})

export const priceUpdate = z.object({ price: amount.max(100_000_000, 'Prix de vente trop élevé.') })

export const customerInput = z.object({ name: nameText, phone: phoneText })

/* Paliers de prix : seuil entier >= 2 unités, prix entier >= 0 F */
export const tierModeInput = z.enum(['palier', 'tranche'])

export const tierInput = z.object({
  min_quantity: z
    .number({ invalid_type_error: 'Quantité numérique attendue.' })
    .int('Le seuil doit être un nombre entier d’unités.')
    .min(2, 'Un palier commence à partir de 2 unités.')
    .max(999999, 'Seuil trop élevé.'),
  unit_price: amount,
})

/** Règle par défaut d'une boutique : seuil et remise habituels (préremplissage seul) */
export const shopTierDefaultInput = z.object({
  min_quantity: z
    .number({ invalid_type_error: 'Quantité numérique attendue.' })
    .int('Le seuil doit être un nombre entier d’unités.')
    .min(2, 'Un palier commence à partir de 2 unités.')
    .max(999999, 'Seuil trop élevé.'),
  discount_pct: z
    .number({ invalid_type_error: 'Remise numérique attendue.' })
    .min(0.5, 'Remise trop faible (0,5 % minimum).')
    .max(90, 'Remise trop forte (90 % maximum).'),
})
export const saleInput = z
  .object({
    itemId: z.string().min(1, 'Article introuvable.'),
    quantity,
    payment: z.enum(['comptant', 'crédit']),
    customerId: z.string().min(1).optional(),
    deposit: amount.optional(),
    dueDate: dateISO.nullable().optional(),
    date: dateNoFuture,
    overridePrice: amount.optional(),
    overrideNote: z.string().trim().max(200, '200 caractères maximum.').optional(),
    saleMode: z.enum(['cumul_jour', 'un_client']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.payment === 'crédit' && !v.customerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customerId'], message: 'Choisis un client pour une vente à crédit.' })
    }
    if (v.dueDate && v.dueDate < v.date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'L’échéance ne peut pas être avant la date de vente.' })
    }
    if (v.dueDate && v.dueDate > addYear(v.date)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Échéance trop lointaine (1 an maximum).' })
    }
  })

export const restockInput = z
  .object({
    itemId: z.string().min(1, 'Article introuvable.'),
    quantity,
    unitCost: amount.max(100_000_000, 'Prix d’achat trop élevé.'),
    date: dateNoFuture,
    supplier: z.string().trim().max(80, '80 caractères maximum.').optional(),
  })

export const creditPaymentInput = z.object({
  amount: positiveAmount,
  date: dateNoFuture,
  note: z.string().trim().max(200, '200 caractères maximum.').optional(),
})

function addYear(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setFullYear(d.getFullYear() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* Mots de passe et code PIN                                           */
/* ------------------------------------------------------------------ */

/** Mots de passe les plus courants : refusés tels quels */
const COMMON_PASSWORDS = [
  '12345678', '123456789', '1234567890', 'password', 'password1', 'motdepasse', 'motdepasse1',
  'azertyuiop', 'qwertyuiop', 'iloveyou', 'admin123', 'sunshine', 'princess', 'football',
  'welcome1', 'abc12345', '11111111', '00000000', 'letmein1', 'monkey12', 'dragon12',
  'senha123', 'baseline', 'whatever', 'trustno1', 'superman', 'starwars', 'passw0rd',
]

export function isCommonPassword(pw: string): boolean {
  const v = pw.trim().toLowerCase()
  return COMMON_PASSWORDS.includes(v)
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  ok: boolean
}

/** Indicateur de robustesse (0 à 4) */
export function passwordStrength(pw: string): PasswordStrength {
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1
  const labels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Excellent']
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4
  const ok = pw.length >= 8 && !isCommonPassword(pw) && s >= 2
  return { score: s, label: labels[s], ok }
}

export const passwordInput = z
  .string()
  .min(8, '8 caractères minimum.')
  .max(128, '128 caractères maximum.')
  .refine((v) => !isCommonPassword(v), 'Ce mot de passe est trop courant, choisis-en un autre.')

export const pinInput = z
  .string()
  .regex(/^\d{4}$/, 'Le code PIN doit contenir exactement 4 chiffres.')
  .or(z.string().regex(/^\d{6}$/, 'Le code PIN doit contenir exactement 6 chiffres.'))

export const emailInput = z.string().trim().email('Adresse e-mail invalide.').max(120, '120 caractères maximum.')

/** Identité demandée à l'inscription (prénom requis pour la salutation) */
export const firstNameInput = z.string().trim().min(1, 'Indique ton prénom.').max(40, '40 caractères maximum.')
export const lastNameInput = z.string().trim().max(40, '40 caractères maximum.')
