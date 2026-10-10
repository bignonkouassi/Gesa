import { num } from './format'

/* ------------------------------------------------------------------ */
/* Devise : point d'entrée unique (seam multi-devises).                 */
/* Aujourd'hui une seule devise est gérée (XOF) : toutes les boutiques */
/* l'utilisent. Quand les tables currencies / taux arriveront,         */
/* shopCurrency lira shop.currency_code et formatMoney utilisera       */
/* Intl.NumberFormat avec minor_unit — sans changer les appelants.     */
/* ------------------------------------------------------------------ */

export type CurrencyCode = string

export const BASE_CURRENCY: CurrencyCode = 'XOF'

/** Libellé d'affichage par devise (symbole). */
export const CURRENCY_LABELS: Record<string, string> = {
  XOF: 'F CFA',
}

/** Nombre de décimales par devise (minor_unit futur). */
export function moneyDecimals(code: CurrencyCode = BASE_CURRENCY): number {
  if (code === BASE_CURRENCY) return 0
  return 2
}

/** Devise d'une boutique (XOF par défaut, en attendant currency_code). */
export function shopCurrency(shop?: { currency_code?: string } | null): CurrencyCode {
  const code = shop && typeof shop.currency_code === 'string' ? shop.currency_code.trim() : ''
  return code || BASE_CURRENCY
}

/** Format monétaire : « 12 500 F CFA », décimales selon la devise. */
export function formatMoney(n: number, code: CurrencyCode = BASE_CURRENCY): string {
  const decimals = moneyDecimals(code)
  const v = Number.isFinite(n) ? n : 0
  const rounded = decimals === 0 ? Math.round(v) : Math.round(v * 100) / 100
  const label = CURRENCY_LABELS[code] ?? code
  if (decimals === 0) return `${num(rounded)} ${label}`
  const int = num(Math.trunc(Math.abs(rounded)))
  const frac = Math.abs(rounded - Math.trunc(rounded))
    .toFixed(decimals)
    .slice(2)
  return `${rounded < 0 ? '-' : ''}${int},${frac} ${label}`
}

/** Nettoie un nom pour un nom de fichier : sans accents ni spéciaux, tirets. */
export function cleanFileName(name: string): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return ascii
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}
